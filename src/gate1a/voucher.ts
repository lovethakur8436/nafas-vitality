/**
 * Gate 1A — bearer-voucher minting + T2 consent grant (Step 8).
 *
 * V3 constraint 5: the voucher is a device-generated bearer code — a
 * random 256-bit token + program code + 30-day expiry. There is no
 * central seed and zero I/O in minting: this module is pure, runs
 * entirely on-device, and the only randomness that enters a voucher is
 * one 32-byte draw from an injected CSPRNG (RN: native secure RNG /
 * expo-crypto, `TODO(native)`; tests: `createSeededRng`). No identity
 * or PII is attached to or transmitted with a voucher — possession of
 * the bearer token is the credential.
 *
 * Eligibility (store contract, Step 3 `acceptKit`): a voucher is minted
 * only for an ELEVATED / HIGH screening estimate. LOW ⇒ rejected,
 * nothing is minted.
 *
 * @format
 */

import type {RiskTier, T2ConsentRecord, Voucher} from './types';
import {
  VOUCHER_PROGRAM_CODE,
  VOUCHER_TTL_MS,
  VOUCHER_TOKEN_HEX_LENGTH,
} from './constants';

/**
 * A source of 32 fresh random bytes. On device this is the native
 * secure RNG (`TODO(native)`) or expo-crypto wrapped to this sync
 * shape; tests inject `createSeededRng`. The draw must be fresh on
 * every call — minting calls it exactly once per voucher.
 */
export type Csprng = () => Uint8Array;

/** Base class for every voucher-mint failure. */
export class VoucherError extends Error {}
/** The risk tier does not permit a voucher (LOW). Nothing is minted. */
export class VoucherNotEligibleError extends VoucherError {}
/** The injected RNG did not return exactly 32 random bytes. */
export class VoucherRngError extends VoucherError {}
/** The voucher failed structural or liveness validation. */
export class VoucherInvalidError extends VoucherError {}

const HEX_DIGITS = '0123456789abcdef';
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * 32 random bytes → 64 lowercase hex chars. The full 256 bits of the
 * draw land in the bearer token — no truncation, no encoding loss.
 */
function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX_DIGITS[b >>> 4] + HEX_DIGITS[b & 0x0f];
  }
  return out;
}

/**
 * Voucher-eligibility gate, mirroring the store contract: ELEVATED /
 * HIGH screening estimates get the home-kit offer; LOW does not.
 */
export function isVoucherEligible(tier: RiskTier): boolean {
  return tier === 'ELEVATED' || tier === 'HIGH';
}

/**
 * Mint a device-local bearer voucher for an eligible screening tier.
 *
 * Pure and offline: one 32-byte draw from `rng`, `mintedAt = now`,
 * `expiresAt = mintedAt + VOUCHER_TTL_MS` (30 days, constants.ts),
 * program code from constants. Throws `VoucherNotEligibleError` for
 * LOW (nothing is minted) and `VoucherRngError` if the draw is not
 * exactly 32 bytes.
 */
export function mintVoucher(
  rng: Csprng,
  tier: RiskTier,
  now: number = Date.now(),
): Voucher {
  if (!isVoucherEligible(tier)) {
    throw new VoucherNotEligibleError(
      `tier ${tier} is not voucher-eligible (ELEVATED / HIGH only)`,
    );
  }
  const bytes = rng();
  if (
    bytes === undefined ||
    !(bytes instanceof Uint8Array) ||
    bytes.length !== 32
  ) {
    throw new VoucherRngError('CSPRNG must return exactly 32 random bytes');
  }
  const mintedAt = now;
  return {
    token: bytesToHex(bytes),
    programCode: VOUCHER_PROGRAM_CODE,
    mintedAt,
    expiresAt: mintedAt + VOUCHER_TTL_MS,
  };
}

/**
 * Structural + liveness check: 64-char lowercase hex token (the full
 * 256-bit draw), the expected program code, sane timestamps, and not
 * expired at `now`.
 */
export function isValidVoucher(
  voucher: Voucher,
  now: number = Date.now(),
): boolean {
  return (
    typeof voucher.token === 'string' &&
    TOKEN_PATTERN.test(voucher.token) &&
    voucher.token.length === VOUCHER_TOKEN_HEX_LENGTH &&
    voucher.programCode === VOUCHER_PROGRAM_CODE &&
    Number.isFinite(voucher.mintedAt) &&
    Number.isFinite(voucher.expiresAt) &&
    voucher.mintedAt < voucher.expiresAt &&
    voucher.expiresAt > now
  );
}

/**
 * Record the T2 consent that accepting the kit grants
 * (scope: `hormone_panel`). On-device only — the record is plain data;
 * Step 9 persists it in the encrypted store. Throws
 * `VoucherInvalidError` for a malformed or already-expired voucher.
 */
export function grantT2(
  voucher: Voucher,
  now: number = Date.now(),
): T2ConsentRecord {
  if (!isValidVoucher(voucher, now)) {
    throw new VoucherInvalidError('grantT2 requires a valid, unexpired voucher');
  }
  return {
    scope: 'hormone_panel',
    grantedAt: now,
    voucherToken: voucher.token,
  };
}

/**
 * Deterministic 32-byte PRNG (mulberry32) for tests and offline mocks
 * ONLY. Not a CSPRNG — never use it for a production mint; it exists so
 * tests can pin mint output (same seed ⇒ same token).
 */
export function createSeededRng(seed: number): Csprng {
  let a = seed >>> 0;
  return () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i += 4) {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const v = (t ^ (t >>> 14)) >>> 0;
      bytes[i] = v & 0xff;
      bytes[i + 1] = (v >>> 8) & 0xff;
      bytes[i + 2] = (v >>> 16) & 0xff;
      bytes[i + 3] = (v >>> 24) & 0xff;
    }
    return bytes;
  };
}
