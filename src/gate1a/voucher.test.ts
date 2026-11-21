/**
 * Step 8 unit tests: bearer-voucher minting + T2 consent grant.
 *
 * Covers: eligibility gate (ELEVATED / HIGH mint, LOW rejects and
 * mints nothing), token shape (64 lowercase hex chars = the full
 * 256-bit draw, no truncation), program code + 30-day expiry math at a
 * fixed clock, determinism under a seeded RNG (same seed ⇒ same
 * token; distinct seeds ⇒ distinct tokens; 100-seed collision sweep),
 * RNG contract (wrong length / non-Uint8Array ⇒ VoucherRngError),
 * structural + liveness validation (tampered program code / token /
 * expired ⇒ rejected), T2 record shape (scope hormone_panel,
 * grantedAt, voucherToken) + rejection of expired/malformed vouchers,
 * and an offline guard: the module source contains no I/O or network
 * primitives.
 *
 * @format
 */

import {readFileSync} from 'fs';
import {join} from 'path';

import {
  VOUCHER_PROGRAM_CODE,
  VOUCHER_TTL_MS,
  VOUCHER_TTL_DAYS,
  VOUCHER_TOKEN_HEX_LENGTH,
} from './constants';
import type {RiskTier, Voucher} from './types';
import {
  createSeededRng,
  grantT2,
  isVoucherEligible,
  isValidVoucher,
  mintVoucher,
  VoucherInvalidError,
  VoucherNotEligibleError,
  VoucherRngError,
} from './voucher';

/** Fixed clock: expiry math is asserted against this, never Date.now(). */
const FIXED_NOW = 1_700_000_000_000;

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Mint a voucher for a tier at the fixed clock with a seeded RNG. */
function mintAt(tier: RiskTier, seed = 0x1234): Voucher {
  return mintVoucher(createSeededRng(seed), tier, FIXED_NOW);
}

describe('Step 8 — voucher eligibility gate', () => {
  it('ELEVATED and HIGH are eligible; LOW is not', () => {
    expect(isVoucherEligible('LOW')).toBe(false);
    expect(isVoucherEligible('ELEVATED')).toBe(true);
    expect(isVoucherEligible('HIGH')).toBe(true);
  });

  it('rejects LOW with VoucherNotEligibleError and mints nothing', () => {
    const rng = createSeededRng(0x9999);
    expect(() => mintVoucher(rng, 'LOW', FIXED_NOW)).toThrow(
      VoucherNotEligibleError,
    );
    // A fresh mint attempt for LOW must also fail — no silent fallback.
    expect(() => mintVoucher(createSeededRng(1), 'LOW', FIXED_NOW)).toThrow(
      VoucherNotEligibleError,
    );
    expect(rng).toBeDefined();
  });
});

describe('Step 8 — token shape (256-bit bearer)', () => {
  it('token is 64 lowercase hex chars — the full 256-bit draw', () => {
    for (const tier of ['ELEVATED', 'HIGH'] as RiskTier[]) {
      const v = mintAt(tier);
      expect(v.token).toMatch(TOKEN_PATTERN);
      expect(v.token.length).toBe(VOUCHER_TOKEN_HEX_LENGTH);
      expect(v.token.length).toBe(64);
      expect(v.token.length).toBe(32 * 2); // 32 bytes, 2 hex chars each
    }
  });

  it('uses every hex digit across a small batch (no encoding loss)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 16; i++) {
      for (const c of mintAt('ELEVATED', 0xabc0 + i).token) {
        seen.add(c);
      }
    }
    expect(seen).toEqual(new Set('0123456789abcdef'));
  });
});

describe('Step 8 — program code + 30-day expiry math', () => {
  it('stamps program code, mintedAt, and expiresAt = mintedAt + 30 d', () => {
    const v = mintAt('HIGH');
    expect(v.programCode).toBe(VOUCHER_PROGRAM_CODE);
    expect(v.mintedAt).toBe(FIXED_NOW);
    expect(v.expiresAt).toBe(FIXED_NOW + VOUCHER_TTL_MS);
    expect(v.expiresAt - v.mintedAt).toBe(VOUCHER_TTL_MS);
    // Sanity: the constants agree with 30 days.
    expect(VOUCHER_TTL_DAYS).toBe(30);
    expect(VOUCHER_TTL_MS).toBe(30 * 86_400_000);
  });

  it('mintedAt follows the injected clock, not wall time', () => {
    const t2 = 1_700_000_000_000 + 5 * 86_400_000; // 5 days later
    const v = mintVoucher(createSeededRng(7), 'ELEVATED', t2);
    expect(v.mintedAt).toBe(t2);
    expect(v.expiresAt).toBe(t2 + VOUCHER_TTL_MS);
  });
});

describe('Step 8 — determinism under a seeded RNG', () => {
  it('same seed ⇒ same token (deterministic)', () => {
    const a = mintAt('ELEVATED', 0xdeadbeef);
    const b = mintAt('ELEVATED', 0xdeadbeef);
    expect(a.token).toBe(b.token);
    expect(a).toEqual(b);
  });

  it('distinct seeds ⇒ distinct tokens', () => {
    const a = mintAt('ELEVATED', 1);
    const b = mintAt('ELEVATED', 2);
    expect(a.token).not.toBe(b.token);
  });

  it('100-seed sweep: no collisions', () => {
    const tokens = new Set<string>();
    for (let seed = 1; seed <= 100; seed++) {
      tokens.add(mintAt('HIGH', seed).token);
    }
    expect(tokens.size).toBe(100);
  });
});

describe('Step 8 — RNG contract', () => {
  it('rejects a draw shorter than 32 bytes', () => {
    const bad = () => new Uint8Array(31);
    expect(() => mintVoucher(bad, 'HIGH', FIXED_NOW)).toThrow(VoucherRngError);
  });

  it('rejects a draw longer than 32 bytes', () => {
    const bad = () => new Uint8Array(33);
    expect(() => mintVoucher(bad, 'HIGH', FIXED_NOW)).toThrow(VoucherRngError);
  });

  it('rejects a non-Uint8Array draw', () => {
    const bad = (() => {
      const arr = new Array(32).fill(1);
      return arr as unknown as Uint8Array;
    }) as () => Uint8Array;
    expect(() => mintVoucher(bad, 'HIGH', FIXED_NOW)).toThrow(VoucherRngError);
  });

  it('a 32-byte draw is accepted', () => {
    const good = () => new Uint8Array(32).fill(0);
    const v = mintVoucher(good, 'ELEVATED', FIXED_NOW);
    expect(v.token).toMatch(TOKEN_PATTERN);
  });
});

describe('Step 8 — structural + liveness validation', () => {
  it('accepts a freshly minted voucher at its mint time', () => {
    const v = mintAt('ELEVATED');
    expect(isValidVoucher(v, FIXED_NOW)).toBe(true);
    // Default clock (Date.now) is far in the future of FIXED_NOW, so an
    // explicit in-window check is the meaningful assertion here.
    expect(isValidVoucher(v, v.mintedAt + 1)).toBe(true);
  });

  it('rejects a voucher at or past its expiry', () => {
    const v = mintAt('ELEVATED');
    expect(isValidVoucher(v, v.expiresAt)).toBe(false);
    expect(isValidVoucher(v, v.expiresAt + 1)).toBe(false);
  });

  it('rejects a tampered program code', () => {
    const v = mintAt('ELEVATED');
    const tampered = {...v, programCode: 'EVIL-CODE'} as Voucher;
    expect(isValidVoucher(tampered, FIXED_NOW)).toBe(false);
  });

  it('rejects a truncated or upper-case token', () => {
    const v = mintAt('ELEVATED');
    expect(isValidVoucher({...v, token: v.token.slice(0, 63)}, FIXED_NOW)).toBe(
      false,
    );
    expect(
      isValidVoucher({...v, token: v.token.toUpperCase()}, FIXED_NOW),
    ).toBe(false);
    expect(
      isValidVoucher({...v, token: v.token + '0'}, FIXED_NOW),
    ).toBe(false);
  });

  it('rejects a voucher whose clock is inverted', () => {
    const v = mintAt('ELEVATED');
    expect(
      isValidVoucher(
        {...v, mintedAt: v.expiresAt + 1, expiresAt: v.mintedAt} as Voucher,
        FIXED_NOW,
      ),
    ).toBe(false);
  });
});

describe('Step 8 — T2 consent grant', () => {
  it('records scope hormone_panel, grantedAt, and voucherToken', () => {
    const v = mintAt('HIGH');
    const record = grantT2(v, FIXED_NOW);
    expect(record).toEqual({
      scope: 'hormone_panel',
      grantedAt: FIXED_NOW,
      voucherToken: v.token,
    });
    expect(record.scope).toBe('hormone_panel');
    expect(record.voucherToken).toBe(v.token);
  });

  it('rejects an expired voucher', () => {
    const v = mintAt('ELEVATED');
    expect(() => grantT2(v, v.expiresAt + 1)).toThrow(VoucherInvalidError);
  });

  it('rejects a malformed voucher', () => {
    const v = mintAt('ELEVATED');
    const tampered = {...v, token: 'nothex'} as Voucher;
    expect(() => grantT2(tampered, FIXED_NOW)).toThrow(VoucherInvalidError);
  });
});

describe('Step 8 — offline guard (zero I/O / no network)', () => {
  it('module source contains no network or I/O primitives', () => {
    const src = readFileSync(join(__dirname, 'voucher.ts'), 'utf8');
    // No network transports, no sockets, no dynamic import of net/child.
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/XMLHttpRequest/);
    expect(src).not.toMatch(/WebSocket/);
    expect(src).not.toMatch(/\brequire\s*\(\s*['"]net['"]/);
    expect(src).not.toMatch(/\bhttp(s?)\b/);
    expect(src).not.toMatch(/child_process/);
    // Only relative imports — no package I/O in the minting module.
    const imports = src.match(/^import .* from '(.*)';/gm) ?? [];
    for (const line of imports) {
      expect(line).toMatch(/from '\.\/[a-z]+';$/);
    }
  });
});
