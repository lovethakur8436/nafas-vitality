/**
 * Gate 1A — encrypted on-device storage + 30-day TTL (Step 9).
 *
 * V3 constraint 4: everything the app keeps is encrypted at rest in the
 * platform secure store (iOS Keychain / Android Keystore), carries a
 * 30-day TTL, is auto-purged (all Gate 1A records are low-risk screening
 * data), and "delete all" is one tap and total.
 *
 * This file defines the platform-agnostic `EncryptedStorage` interface plus
 * a deterministic in-memory mock for the headless test environment:
 *   - mock encryption = base64(JSON) envelope (the real cipher is the native
 *     keystore — TODO(native));
 *   - the clock is INJECTED (`options.now`) so TTL expiry is testable
 *     without real 30-day waits;
 *   - a TTL sweep runs on every `load()` — expired records are auto-purged
 *     as a side effect (plus a public `purgeExpired()` for direct sweeps).
 *
 * Records carry structured data only — never PDF/image bytes (V3
 * constraint 3). All methods are async to mirror the native bridge.
 *
 * @format
 */

import {DATA_TTL_MS} from './constants';

/** A record as stored: every field resolved at save time. */
export interface StorageRecord {
  readonly id: string;
  /** Structured payload (JSON-serializable; never an image buffer). */
  readonly data: unknown;
  /** Epoch ms of the write. */
  readonly createdAt: number;
  /** Lifetime in ms from `createdAt`. */
  readonly ttlMs: number;
}

/** A record being saved; `createdAt`/`ttlMs` are optional. */
export interface SaveRecord {
  readonly id: string;
  readonly data: unknown;
  /** Defaults to the store's clock at save time. */
  readonly createdAt?: number;
  /** Defaults to the store's default TTL (30 days, constants.ts). */
  readonly ttlMs?: number;
}

/**
 * The encrypted-store contract. The real implementation wraps the platform
 * Keychain/Keystore (TODO(native)); `MockEncryptedStorage` is the headless
 * stand-in with the same semantics.
 */
export interface EncryptedStorage {
  /** Encrypts and stores the record (same id ⇒ overwrite). */
  save(record: SaveRecord): Promise<void>;
  /**
   * Loads a record, or `null` when it is absent or already expired.
   * The TTL sweep runs first, so expired records are auto-purged as a
   * side effect of any load.
   */
  load(id: string): Promise<StorageRecord | null>;
  /** Runs the TTL sweep now; resolves with the ids that were purged. */
  purgeExpired(): Promise<string[]>;
  /** One-tap total wipe (V3 constraint 4). Idempotent. */
  deleteAll(): Promise<void>;
}

export interface EncryptedStorageOptions {
  /** Injectable clock (epoch ms). Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Default record TTL in ms. Defaults to `DATA_TTL_MS` (30 days). */
  readonly defaultTtlMs?: number;
}

/* ------------------------------------------------------------------ *
 * Mock encryption: base64(JSON) envelope. A self-contained codec (no
 * Buffer dependency) standing in for the native keystore cipher —
 * TODO(native). Guarantees the at-rest form is not plaintext JSON.
 * ------------------------------------------------------------------ */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toUtf8Bytes(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i) as number;
    if (cp > 0xffff) {
      i++; // consume the trailing surrogate half
    }
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      bytes.push(
        0xe0 | (cp >> 12),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return bytes;
}

function fromUtf8Bytes(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    let cp: number;
    if (b < 0x80) {
      cp = b;
    } else if (b < 0xe0) {
      cp = ((b & 0x1f) << 6) | (bytes[++i] & 0x3f);
    } else if (b < 0xf0) {
      cp =
        ((b & 0x0f) << 12) |
        ((bytes[++i] & 0x3f) << 6) |
        (bytes[++i] & 0x3f);
    } else {
      cp =
        ((b & 0x07) << 18) |
        ((bytes[++i] & 0x3f) << 12) |
        ((bytes[++i] & 0x3f) << 6) |
        (bytes[++i] & 0x3f);
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

function base64Encode(s: string): string {
  const bytes = toUtf8Bytes(s);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += has1 ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += has2 ? B64[b2 & 63] : '=';
  }
  return out;
}

function base64Decode(s: string): string {
  const clean = s.replace(/=+$/, '');
  const bytes: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) {
      throw new Error(`storage: corrupt ciphertext (bad char ${JSON.stringify(ch)})`);
    }
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  return fromUtf8Bytes(bytes);
}

function mockEncrypt(data: unknown): string {
  return base64Encode(JSON.stringify(data));
}

function mockDecrypt(ciphertext: string): unknown {
  return JSON.parse(base64Decode(ciphertext));
}

/* ------------------------------------------------------------------ */

interface StoredEntry {
  readonly createdAt: number;
  readonly ttlMs: number;
  /** Mock ciphertext (base64 envelope of the JSON payload). */
  readonly ciphertext: string;
}

/**
 * Deterministic in-memory stand-in for the native encrypted keystore.
 * TTL semantics are identical to the real thing: `load` sweeps first,
 * `deleteAll` is total, and the clock is injected for testability.
 */
export class MockEncryptedStorage implements EncryptedStorage {
  private readonly now: () => number;
  private readonly defaultTtlMs: number;
  private readonly entries = new Map<string, StoredEntry>();

  constructor(options: EncryptedStorageOptions = {}) {
    this.now = options.now ?? Date.now;
    this.defaultTtlMs = options.defaultTtlMs ?? DATA_TTL_MS;
  }

  async save(record: SaveRecord): Promise<void> {
    const createdAt = record.createdAt ?? this.now();
    const ttlMs = record.ttlMs ?? this.defaultTtlMs;
    this.entries.set(record.id, {
      createdAt,
      ttlMs,
      ciphertext: mockEncrypt(record.data),
    });
  }

  async load(id: string): Promise<StorageRecord | null> {
    this.sweep();
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return null;
    }
    return {
      id,
      data: mockDecrypt(entry.ciphertext),
      createdAt: entry.createdAt,
      ttlMs: entry.ttlMs,
    };
  }

  async purgeExpired(): Promise<string[]> {
    return this.sweep();
  }

  async deleteAll(): Promise<void> {
    this.entries.clear();
  }

  /** Records currently at rest (including expired-but-not-yet-swept). */
  get size(): number {
    return this.entries.size;
  }

  /** Test-only: exposes the mock at-rest ciphertext for `id`. */
  ciphertext(id: string): string | null {
    return this.entries.get(id)?.ciphertext ?? null;
  }

  /** TTL sweep: removes every record with `now >= createdAt + ttlMs`. */
  private sweep(): string[] {
    const nowMs = this.now();
    const purged: string[] = [];
    for (const [id, entry] of this.entries) {
      if (nowMs >= entry.createdAt + entry.ttlMs) {
        this.entries.delete(id);
        purged.push(id);
      }
    }
    return purged;
  }
}
