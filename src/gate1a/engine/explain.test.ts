/**
 * Step 7 unit tests: on-device SHAP explanation (plain language).
 *
 * Covers: exactly 3 ranked sentences + the screening disclaimer constant,
 * purity (same input ⇒ identical output, input not mutated), |contribution|
 * ranking regardless of input order, per-kind sentence direction (risk
 * "higher" / protective "lower" / red flag "you reported"), neutral copy
 * for zero-contribution and unknown feature keys, the <50 ms SHAP budget,
 * and snapshot tests of the 3 sentences per tier (LOW / ELEVATED / HIGH)
 * produced by MockMetabolicModel.
 *
 * @format
 */

import {
  METABOLIC_FEATURE_ORDER,
  PERFORMANCE_BUDGETS_MS,
  SCREENING_DISCLAIMER,
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
  ShapFactor,
} from '../types';
import {MockMetabolicModel} from './MockMetabolicModel';
import {SHAP_TOP_K, explainTopFactors} from './explain';

const FIXED_NOW = 1_700_000_000_000;
const CONTENT_HASH = '0'.repeat(64);

// ── Vector fixtures (same profiles as the Step 6 tier tests) ──────────────

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
async function scoreVector(vector: MetabolicVector) {
  const engine = new MockMetabolicModel({now: () => FIXED_NOW});
  await engine.load();
  return engine.score(vector);
}

// ── Shape & disclaimer ─────────────────────────────────────────────────────

describe('shape & disclaimer', () => {
  it('returns exactly SHAP_TOP_K sentences + the screening disclaimer constant', async () => {
    const shap = (await scoreVector(MID_VECTOR)).shap;
    const explanation = explainTopFactors(shap);
    expect(explanation.sentences).toHaveLength(SHAP_TOP_K);
    expect(SHAP_TOP_K).toBe(3);
    expect(explanation.sentences.every(s => s.length > 0)).toBe(true);
    expect(explanation.disclaimer).toBe(SCREENING_DISCLAIMER);
    expect(explanation.disclaimer).toBe(
      'This is a screening estimate, not a diagnosis.',
    );
  });

  it('works on a plain ShapFactor[] (no result object needed)', () => {
    const explanation = explainTopFactors([
      {featureKey: 'fasting_glucose', contribution: 0.9},
    ]);
    expect(explanation.sentences).toHaveLength(1);
    expect(explanation.disclaimer).toBe(SCREENING_DISCLAIMER);
  });
});

// ── Purity & ranking ───────────────────────────────────────────────────────

describe('purity & ranking', () => {
  const factors: readonly ShapFactor[] = [
    {featureKey: 'triglycerides', contribution: 0.3},
    {featureKey: 'hba1c', contribution: 1.2},
    {featureKey: 'hdl', contribution: 0.5},
    {featureKey: 'smoking', contribution: 0.8},
  ];

  it('same input ⇒ identical output (deterministic, pure)', () => {
    const a = explainTopFactors(factors);
    const b = explainTopFactors(factors);
    expect(b).toEqual(a);
  });

  it('does not mutate the input array (re-sorts on a copy)', () => {
    const before = factors.map(f => ({...f}));
    explainTopFactors(factors);
    expect(factors).toEqual(before);
  });

  it('ranks by |contribution| regardless of input order (keeps top-3 of 4)', () => {
    const explanation = explainTopFactors(factors);
    // 1.2 (hba1c) > 0.8 (smoking) > 0.5 (hdl); 0.3 (triglycerides) dropped.
    expect(explanation.sentences[0]).toContain('HbA1c');
    expect(explanation.sentences[1]).toContain('current smoking');
    expect(explanation.sentences[2]).toContain('HDL cholesterol');
    expect(explanation.sentences.join(' ')).not.toContain('Triglycerides');
  });
});

// ── Sentence direction per feature kind ────────────────────────────────────

describe('sentence direction per feature kind', () => {
  it('risk lab feature ⇒ "higher than the reference range"', () => {
    const {sentences} = explainTopFactors([
      {featureKey: 'fasting_glucose', contribution: 0.9},
    ]);
    expect(sentences[0]).toBe(
      'Your fasting glucose is higher than the reference range — ' +
        'this is the biggest factor in this estimate.',
    );
  });

  it('protective lab feature ⇒ "lower than the reference range"', () => {
    const {sentences} = explainTopFactors([{featureKey: 'hdl', contribution: 0.4}]);
    expect(sentences[0]).toBe(
      'Your HDL cholesterol is lower than the reference range — ' +
        'this is the biggest factor in this estimate.',
    );
  });

  it('red flag ⇒ "You reported …"', () => {
    const {sentences} = explainTopFactors([
      {featureKey: 'hypertension', contribution: 0.9},
    ]);
    expect(sentences[0]).toBe(
      'You reported high blood pressure (hypertension) — ' +
        'this is the biggest factor in this estimate.',
    );
  });

  it('rank words scale with position (biggest / second biggest / third biggest)', () => {
    const {sentences} = explainTopFactors([
      {featureKey: 'hba1c', contribution: 1.2},
      {featureKey: 'fasting_glucose', contribution: 0.9},
      {featureKey: 'triglycerides', contribution: 0.7},
    ]);
    expect(sentences[0]).toContain('the biggest factor');
    expect(sentences[1]).toContain('the second biggest factor');
    expect(sentences[2]).toContain('the third biggest factor');
  });
});

// ── Edge cases (zero contribution, unknown key) ────────────────────────────

describe('edge cases', () => {
  it('zero-contribution factor ⇒ neutral sentence, no false range claim', () => {
    const {sentences} = explainTopFactors([
      {featureKey: 'hba1c', contribution: 0},
    ]);
    expect(sentences[0]).toBe('This factor does not push this estimate up.');
    expect(sentences[0]).not.toContain('reference range');
  });

  it('unknown feature key ⇒ graceful neutral sentence (no throw)', () => {
    const {sentences} = explainTopFactors([
      {featureKey: 'newly_discovered_marker', contribution: 0.5},
    ]);
    expect(sentences[0]).toBe(
      'A model factor (newly_discovered_marker) contributed to this estimate.',
    );
  });
});

// ── Per-tier snapshots (LOW / ELEVATED / HIGH) ─────────────────────────────

describe('per-tier snapshots (mock model top-3 → 3 sentences)', () => {
  it('LOW tier', async () => {
    const result = await scoreVector(HEALTHY_VECTOR);
    expect(result.tier).toBe('LOW');
    expect(result.probability).toBeLessThan(TIER_CUT_POINTS.elevated);
    expect(explainTopFactors(result.shap).sentences).toMatchSnapshot();
  });

  it('ELEVATED tier', async () => {
    const result = await scoreVector(MID_VECTOR);
    expect(result.tier).toBe('ELEVATED');
    expect(result.probability).toBeGreaterThanOrEqual(TIER_CUT_POINTS.elevated);
    expect(result.probability).toBeLessThan(TIER_CUT_POINTS.high);
    expect(explainTopFactors(result.shap).sentences).toMatchSnapshot();
  });

  it('HIGH tier', async () => {
    const result = await scoreVector(HIGH_VECTOR);
    expect(result.tier).toBe('HIGH');
    expect(result.probability).toBeGreaterThanOrEqual(TIER_CUT_POINTS.high);
    expect(explainTopFactors(result.shap).sentences).toMatchSnapshot();
  });
});

// ── Performance budget ─────────────────────────────────────────────────────

describe('performance budget', () => {
  it('each explainTopFactors call stays under the 50 ms SHAP budget', async () => {
    const shap = (await scoreVector(HIGH_VECTOR)).shap;
    const budgetMs = PERFORMANCE_BUDGETS_MS.shap;
    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      explainTopFactors(shap);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(budgetMs);
    }
  });
});
