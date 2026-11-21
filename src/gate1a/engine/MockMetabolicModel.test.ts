/**
 * Step 6 unit tests: InferenceEngine contract + MockMetabolicModel.
 *
 * Covers: load/score contract (not_loaded, corrupt_bundle, model-version
 * stamp), tier boundaries at TIER_CUT_POINTS (LOW / ELEVATED / HIGH
 * fixtures with pinned probabilities), risk monotonicity (interpolated
 * sweep across all 16 features), top-3 SHAP ranking, determinism (fixed
 * clock, fresh instances), the <20 ms inference budget, and the
 * feature-order / canonical-unit vector contract (invalid_vector).
 *
 * @format
 */

import {
  METABOLIC_FEATURE_ORDER,
  PERFORMANCE_BUDGETS_MS,
  TIER_CUT_POINTS,
  type MetabolicFeatureKey,
} from '../constants';
import {computeDerivedRatios, getEntry} from '../ontology';
import type {
  Anthropometrics,
  LabValue,
  LifestyleFields,
  MetabolicVector,
  RedFlags,
  RiskTier,
} from '../types';
import {isInferenceError, type InferenceEngine} from './InferenceEngine';
import {MOCK_MODEL_VERSION, MockMetabolicModel} from './MockMetabolicModel';

const FIXED_NOW = 1_700_000_000_000;
const CONTENT_HASH = '0'.repeat(64);

/** Risk ordering (NOT lexicographic: 'LOW' > 'HIGH' as strings). */
const TIER_RANK: Record<RiskTier, number> = {LOW: 0, ELEVATED: 1, HIGH: 2};

// ── Vector fixtures ────────────────────────────────────────────────────────

const HEALTHY_LABS: Record<MetabolicFeatureKey, number> = {
  hba1c: 5.2,
  fasting_glucose: 92,
  triglycerides: 110,
  hdl: 55,
  total_cholesterol: 180,
  hs_crp: 0.8,
};

const MID_LABS: Record<MetabolicFeatureKey, number> = {
  hba1c: 6.4,
  fasting_glucose: 130,
  triglycerides: 180,
  hdl: 45,
  total_cholesterol: 240,
  hs_crp: 4.5,
};

const HIGH_LABS: Record<MetabolicFeatureKey, number> = {
  hba1c: 9.5,
  fasting_glucose: 210,
  triglycerides: 450,
  hdl: 25,
  total_cholesterol: 290,
  hs_crp: 8.5,
};

function labValue(testId: MetabolicFeatureKey, value: number): LabValue {
  const entry = getEntry(testId);
  expect(entry).toBeDefined();
  return {
    testId,
    value,
    unit: entry!.canonicalUnit,
    confidence: 1,
    source: 'manual',
    confirmedAt: FIXED_NOW,
  };
}

interface VectorParts {
  labs: Record<MetabolicFeatureKey, number>;
  anthropometrics?: Anthropometrics;
  lifestyle?: LifestyleFields;
  redFlags?: RedFlags;
}

function makeVector({
  labs,
  anthropometrics = {height_cm: 170, weight_kg: 70, waist_cm: 80},
  lifestyle = {
    age_years: 35,
    exercise_minutes_per_week: 210,
    alcohol_drinks_per_week: 1,
    sleep_hours_per_night: 7.5,
  },
  redFlags = {smoking: false, hypertension: false, family_history_t2d: false},
}: VectorParts): MetabolicVector {
  return {
    values: METABOLIC_FEATURE_ORDER.map(testId => labValue(testId, labs[testId])),
    anthropometrics,
    derived: computeDerivedRatios(
      anthropometrics,
      labs.fasting_glucose,
      labs.triglycerides,
    ),
    lifestyle,
    redFlags,
    assembledAt: FIXED_NOW,
    contentHash: CONTENT_HASH,
  };
}

const HEALTHY_VECTOR = makeVector({labs: HEALTHY_LABS});
const MID_VECTOR = makeVector({
  labs: MID_LABS,
  anthropometrics: {height_cm: 170, weight_kg: 92, waist_cm: 100},
  lifestyle: {
    age_years: 52,
    exercise_minutes_per_week: 60,
    alcohol_drinks_per_week: 8,
    sleep_hours_per_night: 6,
  },
});
const HIGH_VECTOR = makeVector({
  labs: HIGH_LABS,
  anthropometrics: {height_cm: 170, weight_kg: 105, waist_cm: 110},
  lifestyle: {
    age_years: 70,
    exercise_minutes_per_week: 0,
    alcohol_drinks_per_week: 20,
    sleep_hours_per_night: 5,
  },
  redFlags: {smoking: true, hypertension: true, family_history_t2d: true},
});

/** Fresh, loaded model with a frozen clock. */
const loaded = (): Promise<InferenceEngine> => {
  const engine = new MockMetabolicModel({now: () => FIXED_NOW});
  return (async () => {
    await engine.load();
    return engine;
  })();
};

async function expectInferenceCode(
  code: Promise<void> | (() => unknown),
  expected: string,
): Promise<void> {
  let error: unknown;
  try {
    if (typeof code === 'function') {
      code();
    } else {
      await code;
    }
  } catch (e) {
    error = e;
  }
  expect(isInferenceError(error)).toBe(true);
  if (!isInferenceError(error)) {
    throw new Error('expected an InferenceError');
  }
  expect(error.code).toBe(expected);
}

// ── Contract ───────────────────────────────────────────────────────────────

describe('InferenceEngine contract (MockMetabolicModel)', () => {
  it('score before load rejects with InferenceError(not_loaded)', async () => {
    const engine = new MockMetabolicModel({now: () => FIXED_NOW});
    await expectInferenceCode(
      () => engine.score(HEALTHY_VECTOR),
      'not_loaded',
    );
  });

  it('load resolves and score stamps modelVersion mock-0.0.1', async () => {
    const engine = new MockMetabolicModel({now: () => FIXED_NOW});
    await engine.load();
    expect(engine.modelVersion).toBe(MOCK_MODEL_VERSION);
    expect(engine.modelVersion).toBe('mock-0.0.1');

    const result = engine.score(HEALTHY_VECTOR);
    expect(result.modelVersion).toBe('mock-0.0.1');
    expect(result.computedAt).toBe(FIXED_NOW);
    expect(result.probability).toBeGreaterThanOrEqual(0);
    expect(result.probability).toBeLessThanOrEqual(1);
  });

  it('a corrupt bundle rejects load with InferenceError(corrupt_bundle)', async () => {
    const engine = new MockMetabolicModel({simulateCorruptBundle: true});
    await expectInferenceCode(engine.load(), 'corrupt_bundle');
  });
});

// ── Tier boundaries ────────────────────────────────────────────────────────

describe('tier boundaries (TIER_CUT_POINTS)', () => {
  it('healthy profile ⇒ LOW (p < 0.4)', async () => {
    const result = (await loaded()).score(HEALTHY_VECTOR);
    expect(result.probability).toBeCloseTo(0.08706577, 6);
    expect(result.probability).toBeLessThan(TIER_CUT_POINTS.elevated);
    expect(result.tier).toBe('LOW');
  });

  it('intermediate profile ⇒ ELEVATED (0.4 ≤ p < 0.7)', async () => {
    const result = (await loaded()).score(MID_VECTOR);
    expect(result.probability).toBeCloseTo(0.59992915, 6);
    expect(result.probability).toBeGreaterThanOrEqual(TIER_CUT_POINTS.elevated);
    expect(result.probability).toBeLessThan(TIER_CUT_POINTS.high);
    expect(result.tier).toBe('ELEVATED');
  });

  it('high-risk profile ⇒ HIGH (p ≥ 0.7)', async () => {
    const result = (await loaded()).score(HIGH_VECTOR);
    expect(result.probability).toBeCloseTo(0.99949555, 6);
    expect(result.probability).toBeGreaterThanOrEqual(TIER_CUT_POINTS.high);
    expect(result.tier).toBe('HIGH');
  });

  it('full-feature risk sweep is monotone and crosses LOW → ELEVATED → HIGH', async () => {
    const engine = await loaded();
    const mix = (a: number, b: number, t: number): number => a + t * (b - a);
    const seen = new Set<RiskTier>();
    let prevP = -Infinity;
    let prevRank = -1;

    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const vector = makeVector({
        labs: {
          hba1c: mix(5.2, 9.5, t),
          fasting_glucose: mix(92, 210, t),
          triglycerides: mix(110, 450, t),
          hdl: mix(55, 25, t),
          total_cholesterol: mix(180, 290, t),
          hs_crp: mix(0.8, 8.5, t),
        },
        anthropometrics: {
          height_cm: 170,
          weight_kg: mix(70, 105, t),
          waist_cm: mix(80, 110, t),
        },
        lifestyle: {
          age_years: mix(35, 70, t),
          exercise_minutes_per_week: mix(210, 0, t),
          alcohol_drinks_per_week: mix(1, 20, t),
          sleep_hours_per_night: mix(7.5, 5, t),
        },
        redFlags: {
          smoking: t > 0.5,
          hypertension: t > 0.5,
          family_history_t2d: t > 0.5,
        },
      });
      const result = engine.score(vector);
      seen.add(result.tier);
      expect(result.probability).toBeGreaterThanOrEqual(prevP);
      expect(TIER_RANK[result.tier]).toBeGreaterThanOrEqual(prevRank);
      // Tier always consistent with the cut points.
      const expectedTier: RiskTier =
        result.probability < TIER_CUT_POINTS.elevated
          ? 'LOW'
          : result.probability < TIER_CUT_POINTS.high
            ? 'ELEVATED'
            : 'HIGH';
      expect(result.tier).toBe(expectedTier);
      prevP = result.probability;
      prevRank = TIER_RANK[result.tier];
    }
    expect(seen).toEqual(new Set<RiskTier>(['LOW', 'ELEVATED', 'HIGH']));
  });
});

// ── SHAP factors ───────────────────────────────────────────────────────────

describe('SHAP factors', () => {
  it('always returns exactly 3 factors ranked by |contribution|', async () => {
    const engine = await loaded();
    for (const vector of [HEALTHY_VECTOR, MID_VECTOR, HIGH_VECTOR]) {
      const result = engine.score(vector);
      expect(result.shap).toHaveLength(3);
      const mags = result.shap.map(f => Math.abs(f.contribution));
      for (let i = 1; i < mags.length; i++) {
        expect(mags[i - 1]).toBeGreaterThanOrEqual(mags[i]);
      }
      expect(result.shap.every(f => typeof f.featureKey === 'string')).toBe(true);
    }
  });

  it('high-risk: top-3 is hba1c, hypertension, bmi (bmi ties smoking at 0.8, wins by feature order)', async () => {
    const result = (await loaded()).score(HIGH_VECTOR);
    expect(result.shap).toEqual([
      {featureKey: 'hba1c', contribution: 1.2},
      {featureKey: 'hypertension', contribution: 0.9},
      {featureKey: 'bmi', contribution: 0.8},
    ]);
  });

  it('healthy: top-3 is hdl, age_years, then a zero-contribution feature in feature order', async () => {
    const result = (await loaded()).score(HEALTHY_VECTOR);
    expect(result.shap[0].featureKey).toBe('hdl');
    expect(result.shap[0].contribution).toBeCloseTo(0.08, 10);
    expect(result.shap[1].featureKey).toBe('age_years');
    expect(result.shap[1].contribution).toBeCloseTo(0.07, 10);
    expect(result.shap[2].contribution).toBe(0);
    expect(result.shap[2].featureKey).toBe('hba1c'); // first all-zero feature
  });
});

// ── Determinism ────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('same vector ⇒ identical result (incl. computedAt under a frozen clock)', async () => {
    const engine = await loaded();
    const a = engine.score(HIGH_VECTOR);
    const b = engine.score(HIGH_VECTOR);
    expect(b).toEqual(a);
    expect(a.computedAt).toBe(FIXED_NOW);
  });

  it('two fresh instances agree on the same vector', async () => {
    const e1 = new MockMetabolicModel({now: () => FIXED_NOW});
    const e2 = new MockMetabolicModel({now: () => FIXED_NOW});
    await e1.load();
    await e2.load();
    expect(e2.score(MID_VECTOR)).toEqual(e1.score(MID_VECTOR));
  });
});

// ── Performance budget ─────────────────────────────────────────────────────

describe('performance budget', () => {
  it('each score call stays under the 20 ms inference budget', async () => {
    const engine = await loaded();
    const budgetMs = PERFORMANCE_BUDGETS_MS.inference;
    for (let i = 0; i < 50; i++) {
      const start = Date.now();
      engine.score(HIGH_VECTOR);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(budgetMs);
    }
  });
});

// ── Vector contract (feature order + canonical units) ──────────────────────

describe('vector contract', () => {
  const expectInvalidVector = (engine: InferenceEngine, vector: MetabolicVector) =>
    expectInferenceCode(() => engine.score(vector), 'invalid_vector');

  it('rejects values out of METABOLIC_FEATURE_ORDER (swapped hba1c/glucose)', async () => {
    const engine = await loaded();
    const vector = makeVector({labs: HEALTHY_LABS});
    const [a, b] = [...vector.values];
    expectInvalidVector(
      engine,
      {...vector, values: [b, a, ...vector.values.slice(2)]},
    );
  });

  it('rejects a short values array (5 of 6)', async () => {
    const engine = await loaded();
    const vector = makeVector({labs: HEALTHY_LABS});
    expectInvalidVector(
      engine,
      {...vector, values: vector.values.slice(0, 5)},
    );
  });

  it('rejects a non-canonical unit (mg/dL glucose sent as mmol/L)', async () => {
    const engine = await loaded();
    const vector = makeVector({labs: HEALTHY_LABS});
    const bad = vector.values.map(v =>
      v.testId === 'fasting_glucose' ? {...v, value: 5.0, unit: 'mmol/L'} : v,
    );
    expectInvalidVector(engine, {...vector, values: bad});
  });

  it('rejects a non-finite lab value (NaN)', async () => {
    const engine = await loaded();
    const vector = makeVector({labs: HEALTHY_LABS});
    const bad = vector.values.map(v =>
      v.testId === 'hba1c' ? {...v, value: NaN} : v,
    );
    expectInvalidVector(engine, {...vector, values: bad});
  });

  it('rejects a non-boolean red flag', async () => {
    const engine = await loaded();
    const vector = makeVector({labs: HEALTHY_LABS});
    expectInvalidVector(
      engine,
      {
        ...vector,
        redFlags: {
          smoking: 'yes' as unknown as boolean,
          hypertension: false,
          family_history_t2d: false,
        },
      },
    );
  });
});
