/**
 * Step 9 unit tests: EncryptedStorage + MockEncryptedStorage.
 *
 * Covers: save/load round-trip, 30-day default TTL, TTL expiry at the
 * exact boundary (and survival just before it), custom TTLs, explicit
 * createdAt, the TTL sweep that runs on load (only expired records are
 * purged), purgeExpired bookkeeping, deleteAll total wipe, overwrite
 * semantics, injected-clock expiry (no real waiting, no real Date.now),
 * and the non-plaintext at-rest form.
 *
 * @format
 */

import {DATA_TTL_DAYS, DATA_TTL_MS} from './constants';
import {MockEncryptedStorage} from './storage';
import type {StorageRecord} from './storage';

const DAY = 86_400_000;

/** A store on a fixed, mutable clock starting at 1970-01-01 + 1 s. */
function withClock(): {
  store: MockEncryptedStorage;
  advance: (ms: number) => void;
  t: () => number;
} {
  let t = 1_000_000;
  const store = new MockEncryptedStorage({now: () => t});
  return {
    store,
    advance: ms => {
      t += ms;
    },
    t: () => t,
  };
}

describe('MockEncryptedStorage — save/load round-trip', () => {
  it('returns the saved record with defaults resolved (clock, 30-day TTL)', async () => {
    const {store, t} = withClock();
    const data = {tier: 'LOW', values: {hba1c: 5.1}};

    await store.save({id: 'record-1', data});

    expect(DATA_TTL_DAYS).toBe(30);
    expect(DATA_TTL_MS).toBe(30 * DAY);

    const loaded = await store.load('record-1');
    expect(loaded).toEqual({
      id: 'record-1',
      data,
      createdAt: t(),
      ttlMs: DATA_TTL_MS,
    } satisfies StorageRecord);
    expect(store.size).toBe(1);
  });

  it('overwrites when the same id is saved again', async () => {
    const {store} = withClock();
    await store.save({id: 'v', data: {n: 1}});
    await store.save({id: 'v', data: {n: 2}});

    expect((await store.load('v'))!.data).toEqual({n: 2});
    expect(store.size).toBe(1);
  });

  it('load of an unknown id resolves to null', async () => {
    const {store} = withClock();
    expect(await store.load('nope')).toBeNull();
  });
});

describe('MockEncryptedStorage — 30-day TTL', () => {
  it('expires exactly at the TTL boundary (now >= createdAt + ttlMs)', async () => {
    const {store, advance} = withClock();
    await store.save({id: 'a', data: {}});

    advance(DATA_TTL_MS); // exactly 30 days later
    expect(await store.load('a')).toBeNull();
    expect(store.size).toBe(0);
  });

  it('survives one millisecond before the TTL boundary', async () => {
    const {store, advance} = withClock();
    await store.save({id: 'a', data: {keep: true}});

    advance(DATA_TTL_MS - 1);
    expect((await store.load('a'))!.data).toEqual({keep: true});
  });

  it('honors a custom ttlMs shorter than the 30-day default', async () => {
    const {store, advance} = withClock();
    await store.save({id: 'short', data: {}, ttlMs: 60_000});

    advance(59_999);
    expect(await store.load('short')).not.toBeNull();
    advance(1);
    expect(await store.load('short')).toBeNull();
  });

  it('honors an explicit createdAt in the past (already-expired save)', async () => {
    const {store, t} = withClock();
    await store.save({
      id: 'old',
      data: {},
      createdAt: t() - 40 * DAY,
      ttlMs: DATA_TTL_MS,
    });

    expect(await store.load('old')).toBeNull();
  });
});

describe('MockEncryptedStorage — TTL sweep on load', () => {
  it('purges only the expired records and leaves the fresh ones', async () => {
    const {store, advance} = withClock();
    await store.save({id: 'a', data: {}, ttlMs: 1_000});
    await store.save({id: 'b', data: {}, ttlMs: DATA_TTL_MS});

    advance(2_000); // 'a' expired, 'b' still 30 days out
    const b = await store.load('b');
    expect(b).not.toBeNull();
    expect(await store.load('a')).toBeNull();
    expect(store.size).toBe(1);
  });

  it('purgeExpired reports exactly the ids it purged', async () => {
    const {store, advance} = withClock();
    await store.save({id: 'a', data: {}, ttlMs: 1_000});
    await store.save({id: 'b', data: {}, ttlMs: 1_000});
    await store.save({id: 'c', data: {}, ttlMs: DATA_TTL_MS});

    advance(2_000);
    expect(await store.purgeExpired()).toEqual(['a', 'b']);
    expect(store.size).toBe(1);
    // Sweeping again with nothing expired purges nothing.
    expect(await store.purgeExpired()).toEqual([]);
  });
});

describe('MockEncryptedStorage — deleteAll', () => {
  it('is a one-tap total wipe, including fresh records', async () => {
    const {store} = withClock();
    await store.save({id: 'a', data: {x: 1}});
    await store.save({id: 'b', data: {y: 2}});
    await store.save({id: 'c', data: {z: 3}});

    await store.deleteAll();

    expect(store.size).toBe(0);
    expect(await store.load('a')).toBeNull();
    expect(await store.load('b')).toBeNull();
    expect(await store.load('c')).toBeNull();
  });

  it('is idempotent on an empty store', async () => {
    const {store} = withClock();
    await store.deleteAll();
    expect(store.size).toBe(0);
    expect(await store.load('a')).toBeNull();
  });
});

describe('MockEncryptedStorage — injected clock', () => {
  it('TTL expiry is driven by the injected clock, not Date.now', async () => {
    // The clock starts at 1970-01-01 (1 s). If the implementation ever
    // touched the real Date.now (≈2026+), the record below would be
    // long expired — so survival at TTL-1 proves the clock is honored.
    const {store, advance} = withClock();
    await store.save({id: 'clk', data: {}});

    advance(DATA_TTL_MS - 1);
    expect(await store.load('clk')).not.toBeNull();

    advance(1);
    expect(await store.load('clk')).toBeNull();
  });

  it('accepts a custom default TTL via options', async () => {
    let t = 0;
    const store = new MockEncryptedStorage({now: () => t, defaultTtlMs: DAY});
    await store.save({id: 'd', data: {}});
    expect((await store.load('d'))!.ttlMs).toBe(DAY);

    t = 2 * DAY;
    expect(await store.load('d')).toBeNull();
  });
});

describe('MockEncryptedStorage — at-rest form (mock encryption)', () => {
  it('stores the payload as a base64 envelope, never plaintext JSON', async () => {
    const {store} = withClock();
    const data = {token: 'needle-xyz-9876'};
    await store.save({id: 'sec', data});

    const raw = store.ciphertext('sec')!;
    expect(raw).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(raw).not.toContain('needle-xyz-9876');
    expect(raw).not.toContain(JSON.stringify(data));
    expect(store.ciphertext('missing')).toBeNull();
  });
});
