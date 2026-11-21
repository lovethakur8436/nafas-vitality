/**
 * Step 13 render tests: ResultScreen (tier + top-3 factors + voucher CTA).
 *
 * RN 0.88 / React 19.3 convention (see UploadScreen.test.tsx): `await
 * act(...)` plus one `setTimeout(0)` tick before reading the tree. The
 * screen renders a plain View (core SafeAreaView is deprecated in RN 0.88).
 *
 * Covers:
 *   - SCORING ⇒ the effect runs the on-device engine exactly once and the
 *     machine reaches RESULT on the same tick; tier banner + plain-language
 *     top-3 factors (explain.ts) are shown; the result is persisted.
 *   - RESULT (ELEVATED) ⇒ kit offer; "Accept home kit" mints one fresh
 *     bearer voucher (seeded CSPRNG ⇒ deterministic 64-hex token), grants
 *     T2 consent (scope `hormone_panel`), persists the voucher with the
 *     30-day TTL stamp, and shows the voucher card (CTA row disappears).
 *   - RESULT (LOW) ⇒ no kit offer, "No action needed" copy, result
 *     persisted under the default 30-day TTL (auto-purge path).
 *   - "Delete all" (one tap) ⇒ total storage wipe ⇒ store back to IDLE.
 *
 * @format
 */

import {act} from 'react';
import ReactTestRenderer from 'react-test-renderer';

import ResultScreen from './ResultScreen';
import {GATE1A_INITIAL_STATE, useGate1AStore} from '../store';
import {
  MOCK_MODEL_VERSION,
  MockMetabolicModel,
} from '../engine/MockMetabolicModel';
import type {InferenceEngine} from '../engine/InferenceEngine';
import {MockEncryptedStorage} from '../storage';
import {createSeededRng, mintVoucher, type Csprng} from '../voucher';
import {
  DATA_TTL_MS,
  VOUCHER_PROGRAM_CODE,
  VOUCHER_TTL_MS,
} from '../constants';
import type {Gate1AResult, MetabolicVector} from '../types';

const tick = (): Promise<void> => new Promise(resolve =>
  setTimeout(resolve, 0),
);

/**
 * A fully confirmed high-risk vector (contract: values[i].testId ===
 * METABOLIC_FEATURE_ORDER[i], canonical units). Mock logit ≈ -2.5 + 7.48
 * ⇒ p ≈ 0.993 ⇒ tier HIGH.
 */
const HIGH_RISK_VECTOR: MetabolicVector = {
  values: [
    {
      testId: 'hba1c',
      value: 8.5,
      unit: '%',
      confidence: 1,
      source: 'manual',
      confirmedAt: 1,
    },
    {
      testId: 'fasting_glucose',
      value: 200,
      unit: 'mg/dL',
      confidence: 1,
      source: 'manual',
      confirmedAt: 1,
    },
    {
      testId: 'triglycerides',
      value: 400,
      unit: 'mg/dL',
      confidence: 1,
      source: 'manual',
      confirmedAt: 1,
    },
    {
      testId: 'hdl',
      value: 15,
      unit: 'mg/dL',
      confidence: 1,
      source: 'manual',
      confirmedAt: 1,
    },
    {
      testId: 'total_cholesterol',
      value: 280,
      unit: 'mg/dL',
      confidence: 1,
      source: 'manual',
      confirmedAt: 1,
    },
    {
      testId: 'hs_crp',
      value: 8,
      unit: 'mg/L',
      confidence: 1,
      source: 'manual',
      confirmedAt: 1,
    },
  ],
  anthropometrics: {height_cm: 170, weight_kg: 96, waist_cm: 105},
  derived: {bmi: 33, whtr: 0.62, tyg_index: 250},
  lifestyle: {
    age_years: 65,
    exercise_minutes_per_week: 30,
    alcohol_drinks_per_week: 8,
    sleep_hours_per_night: 5,
  },
  redFlags: {smoking: false, hypertension: true, family_history_t2d: false},
  assembledAt: 1,
  contentHash: 'test-hash',
};

const ELEVATED_RESULT: Gate1AResult = {
  tier: 'ELEVATED',
  probability: 0.5,
  modelVersion: MOCK_MODEL_VERSION,
  shap: [
    {featureKey: 'hba1c', contribution: 0.9},
    {featureKey: 'fasting_glucose', contribution: 0.5},
    {featureKey: 'hdl', contribution: 0.4},
  ],
  computedAt: 1,
};

const LOW_RESULT: Gate1AResult = {
  tier: 'LOW',
  probability: 0.1,
  modelVersion: MOCK_MODEL_VERSION,
  // The mock pads top-3 with zero-contribution factors on low-risk profiles.
  shap: [
    {featureKey: 'age_years', contribution: 0.1},
    {featureKey: 'sleep_hours_per_night', contribution: 0},
    {featureKey: 'hba1c', contribution: 0},
  ],
  computedAt: 1,
};

/** Flatten every text node of the rendered tree into one searchable string. */
function allText(c: ReactTestRenderer.ReactTestRenderer): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) {
      return;
    }
    if (typeof node === 'string') {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) {
        walk(n);
      }
      return;
    }
    const obj = node as {children?: unknown};
    if (obj.children !== undefined) {
      walk(obj.children);
    }
  };
  walk(c.toJSON());
  return parts.join('\n');
}

async function renderScreen(
  engine: InferenceEngine,
  storage: MockEncryptedStorage,
  rng: Csprng,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  const c = await act(async () =>
    ReactTestRenderer.create(
      <ResultScreen engine={engine} storage={storage} rng={rng} />,
    ),
  );
  await tick();
  return c;
}

describe('ResultScreen — Step 13', () => {
  let engine: MockMetabolicModel;
  let storage: MockEncryptedStorage;
  let rng: Csprng;

  beforeEach(async () => {
    useGate1AStore.setState(GATE1A_INITIAL_STATE);
    engine = new MockMetabolicModel();
    await engine.load();
    storage = new MockEncryptedStorage();
    rng = createSeededRng(42);
  });

  it('SCORING ⇒ engine scores ⇒ RESULT: tier banner + top-3 factors', async () => {
    useGate1AStore.setState({state: 'SCORING', vector: HIGH_RISK_VECTOR});

    const c = await renderScreen(engine, storage, rng);

    // The machine reached RESULT with the mock's HIGH-tier result.
    const s = useGate1AStore.getState();
    expect(s.state).toBe('RESULT');
    expect(s.result).not.toBeNull();
    expect(s.result!.tier).toBe('HIGH');
    expect(s.result!.modelVersion).toBe(MOCK_MODEL_VERSION);

    // Tier banner + plain-language top-3 (explain.ts: HbA1c, hypertension,
    // HDL — the mock's ranking for this high-risk vector).
    const text = allText(c);
    expect(text).toContain('HIGH');
    expect(text).toContain(
      'Your HbA1c is higher than the reference range',
    );
    expect(text).toContain(
      'You reported high blood pressure (hypertension)',
    );
    expect(text).toContain(
      'Your HDL cholesterol is lower than the reference range',
    );

    // ELEVATED/HIGH ⇒ the kit offer CTA is on screen. `findByProps` is
    // shallow in react-test-renderer (React 19.3): it stops at the outermost
    // instance carrying the testID, so exactly one match per Pressable.
    c.root.findByProps({testID: 'result-accept'});

    // The result is persisted on-device (default 30-day TTL).
    const rec = await storage.load('gate1a-result');
    expect(rec).not.toBeNull();
    expect(rec!.ttlMs).toBe(DATA_TTL_MS);
    await act(async () => {
      c.unmount();
    });
  });

  it('ELEVATED ⇒ accept kit ⇒ voucher minted, T2 consent, card shown', async () => {
    useGate1AStore.setState({state: 'RESULT', result: ELEVATED_RESULT});

    const c = await renderScreen(engine, storage, rng);
    // Shallow find ⇒ the CTA Pressable is on screen.
    c.root.findByProps({testID: 'result-accept'});

    await act(async () => {
      c.root.findByProps({testID: 'result-accept'}).props.onPress();
    });
    await tick();

    // Machine in VOUCHER_ACCEPTED; the seeded RNG pins the bearer token.
    const s = useGate1AStore.getState();
    expect(s.state).toBe('VOUCHER_ACCEPTED');
    const v = s.voucher;
    expect(v).not.toBeNull();
    expect(v!.token).toMatch(/^[0-9a-f]{64}$/);
    expect(v!.token).toBe(mintVoucher(createSeededRng(42), 'ELEVATED').token);
    expect(v!.programCode).toBe(VOUCHER_PROGRAM_CODE);
    expect(v!.expiresAt - v!.mintedAt).toBe(VOUCHER_TTL_MS);

    // Voucher card replaces the CTA row; consent scope is displayed.
    expect(c.root.findAllByProps({testID: 'result-accept'})).toHaveLength(0);
    const text = allText(c);
    expect(text).toContain(VOUCHER_PROGRAM_CODE);
    expect(text).toContain(v!.token);
    expect(text).toContain('hormone_panel');

    // The bearer voucher is persisted with the 30-day TTL stamp.
    const rec = await storage.load('gate1a-voucher');
    expect(rec).not.toBeNull();
    expect(rec!.ttlMs).toBe(VOUCHER_TTL_MS);
    expect((rec!.data as {voucher: {token: string}}).voucher.token).toBe(
      v!.token,
    );
    await act(async () => {
      c.unmount();
    });
  });

  it('LOW ⇒ no kit offer: "No action needed", result persisted', async () => {
    useGate1AStore.setState({state: 'RESULT', result: LOW_RESULT});

    const c = await renderScreen(engine, storage, rng);

    expect(c.root.findAllByProps({testID: 'result-accept'})).toHaveLength(0);
    expect(c.root.findAllByProps({testID: 'result-decline'})).toHaveLength(0);
    const text = allText(c);
    expect(text).toContain('LOW');
    expect(text).toContain('No action needed');

    // Persisted under the default 30-day TTL ⇒ the sweep auto-purges it.
    const rec = await storage.load('gate1a-result');
    expect(rec).not.toBeNull();
    expect(rec!.ttlMs).toBe(DATA_TTL_MS);
    await act(async () => {
      c.unmount();
    });
  });

  it('"Delete all" ⇒ total storage wipe ⇒ IDLE', async () => {
    useGate1AStore.setState({state: 'RESULT', result: ELEVATED_RESULT});

    const c = await renderScreen(engine, storage, rng);
    expect(storage.size).toBe(1); // result persisted on render

    await act(async () => {
      c.root
        .findByProps({testID: 'result-delete-all'})
        .props.onPress();
    });
    await tick();

    expect(storage.size).toBe(0);
    expect(useGate1AStore.getState().state).toBe('IDLE');
    expect(allText(c)).toContain('No result yet');
    await act(async () => {
      c.unmount();
    });
  });
});
