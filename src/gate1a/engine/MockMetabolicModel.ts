/**
 * Gate 1A — deterministic mock metabolic model (Step 6).
 *
 * Stand-in for `gate1a_metabolic.onnx` behind the same `InferenceEngine`
 * contract: identical `Gate1AResult` shape, same `modelVersion` stamping,
 * same pure-function semantics, so the signed-bundle ORT path (later
 * workstream) swaps in with no caller changes.
 *
 * Model: a transparent linear risk score. Each of the 16 features is
 * normalized to z ∈ [0,1] against a documented band — `at0` ⇒ z = 0 (no
 * risk signal), `at1` ⇒ z = 1 (full risk signal), linear in between and
 * clamped outside — and contributes `weight * z` to the logit. The
 * probability is `sigmoid(BIAS + Σ contributions)`. The model is monotone
 * in risk: raising any risk-increasing feature never lowers the
 * probability, and raising a protective one (hdl, exercise, sleep) never
 * raises it.
 *
 * All bands and weights are placeholders pending the signed bundle's
 * config.json (V3 constraint 6) — documented here so they stay auditable.
 * Anthropometrics reach the model only through the derived ratios
 * (bmi, whtr, tyg_index); raw height/weight/waist are not direct features.
 *
 * @format
 */

import {
  DERIVED_RATIO_KEYS,
  LIFESTYLE_KEYS,
  METABOLIC_FEATURE_ORDER,
  type MetabolicFeatureKey,
  RED_FLAG_KEYS,
  TIER_CUT_POINTS,
} from '../constants';
import {getEntry} from '../ontology';
import type {
  DerivedRatios,
  Gate1AResult,
  LifestyleFields,
  MetabolicVector,
  RedFlags,
  RiskTier,
  ShapFactor,
} from '../types';
import {InferenceError, type InferenceEngine} from './InferenceEngine';

/** Stable model-version stamp (audit trail + telemetry). */
export const MOCK_MODEL_VERSION = 'mock-0.0.1';

/** Base logit at the all-minimum-risk profile (⇒ p ≈ 0.087, tier LOW). */
const MODEL_BIAS = -2.5;

/** The mock always reports exactly the top-3 SHAP factors (Step 6). */
const SHAP_TOP_K = 3;

type DerivedKey = keyof DerivedRatios;
type LifestyleKey = keyof LifestyleFields;
type RedFlagKey = keyof RedFlags;

/**
 * One model feature. `at0`/`at1` form the normalization band: value at0 ⇒
 * z = 0, value at1 ⇒ z = 1 (z is clamped to [0,1] outside the band). For
 * protective features at1 < at0 (e.g. hdl: 60 ⇒ 0, 10 ⇒ 1), for risk
 * features at1 > at0, for red flags the band is simply 0/1. `weight` is
 * the logit added at z = 1 (always > 0).
 */
export interface LabFeatureSpec {
  readonly kind: 'lab';
  readonly key: MetabolicFeatureKey;
  readonly at0: number;
  readonly at1: number;
  readonly weight: number;
}
export interface DerivedFeatureSpec {
  readonly kind: 'derived';
  readonly key: DerivedKey;
  readonly at0: number;
  readonly at1: number;
  readonly weight: number;
}
export interface LifestyleFeatureSpec {
  readonly kind: 'lifestyle';
  readonly key: LifestyleKey;
  readonly at0: number;
  readonly at1: number;
  readonly weight: number;
}
export interface RedFlagFeatureSpec {
  readonly kind: 'redFlag';
  readonly key: RedFlagKey;
  readonly at0: number;
  readonly at1: number;
  readonly weight: number;
}

export type MockFeatureSpec =
  | LabFeatureSpec
  | DerivedFeatureSpec
  | LifestyleFeatureSpec
  | RedFlagFeatureSpec;

/**
 * The 16 mock features in stable feature order (lab → derived → lifestyle
 * → red flag). Ties in |SHAP contribution| are broken by this order.
 * Placeholder weights, pending the signed bundle's config.json.
 */
export const MOCK_FEATURE_SPECS: readonly MockFeatureSpec[] = [
  // Closed-panel biomarkers, canonical units (bands anchored on the ontology
  // reference ranges).
  {kind: 'lab', key: 'hba1c', at0: 5.6, at1: 9.0, weight: 1.2}, // strongest glycemic driver
  {kind: 'lab', key: 'fasting_glucose', at0: 99, at1: 250, weight: 0.9},
  {kind: 'lab', key: 'triglycerides', at0: 149, at1: 500, weight: 0.7},
  {kind: 'lab', key: 'hdl', at0: 60, at1: 10, weight: 0.8}, // protective: low HDL ⇒ risk
  {kind: 'lab', key: 'total_cholesterol', at0: 200, at1: 300, weight: 0.5},
  {kind: 'lab', key: 'hs_crp', at0: 3.0, at1: 10.0, weight: 0.6},
  // Derived ratios (anthropometrics enter only through these).
  {kind: 'derived', key: 'bmi', at0: 25, at1: 35, weight: 0.8},
  {kind: 'derived', key: 'whtr', at0: 0.5, at1: 0.65, weight: 0.6},
  {kind: 'derived', key: 'tyg_index', at0: 130, at1: 300, weight: 0.7},
  // Numeric lifestyle questionnaire.
  {kind: 'lifestyle', key: 'age_years', at0: 30, at1: 80, weight: 0.7},
  {kind: 'lifestyle', key: 'exercise_minutes_per_week', at0: 150, at1: 0, weight: 0.5}, // protective
  {kind: 'lifestyle', key: 'alcohol_drinks_per_week', at0: 2, at1: 14, weight: 0.4},
  {kind: 'lifestyle', key: 'sleep_hours_per_night', at0: 7, at1: 4, weight: 0.3}, // protective
  // Red-flag booleans (z is the flag itself).
  {kind: 'redFlag', key: 'smoking', at0: 0, at1: 1, weight: 0.8},
  {kind: 'redFlag', key: 'hypertension', at0: 0, at1: 1, weight: 0.9},
  {kind: 'redFlag', key: 'family_history_t2d', at0: 0, at1: 1, weight: 0.7},
];

/**
 * Linear interpolation against the band, clamped: value at0 ⇒ 0, at1 ⇒ 1.
 * One formula covers risk features (at1 > at0), protective features
 * (at1 < at0), and 0/1 red flags.
 */
function normalizeFeature(value: number, at0: number, at1: number): number {
  const z = (at0 - value) / (at0 - at1);
  return Math.min(1, Math.max(0, z));
}

/** Tier cut points from constants.ts: p < elevated ⇒ LOW, < high ⇒ ELEVATED, else HIGH. */
function tierForProbability(probability: number): RiskTier {
  if (probability < TIER_CUT_POINTS.elevated) {
    return 'LOW';
  }
  if (probability < TIER_CUT_POINTS.high) {
    return 'ELEVATED';
  }
  return 'HIGH';
}

export interface MockMetabolicModelOptions {
  /** `load()` rejects with `InferenceError('corrupt_bundle')` (simulated). */
  readonly simulateCorruptBundle?: boolean;
  /** Injectable clock for `computedAt` (defaults to `Date.now`). */
  readonly now?: () => number;
}

/**
 * Deterministic stand-in for `gate1a_metabolic.onnx`. Pure function of the
 * vector: no I/O, no network, no global state, <20 ms budget
 * (PERFORMANCE_BUDGETS_MS.inference).
 */
export class MockMetabolicModel implements InferenceEngine {
  readonly modelVersion = MOCK_MODEL_VERSION;

  private readonly simulateCorruptBundle: boolean;
  private readonly now: () => number;
  private loaded = false;

  constructor(options: MockMetabolicModelOptions = {}) {
    this.simulateCorruptBundle = options.simulateCorruptBundle ?? false;
    this.now = options.now ?? Date.now;
  }

  /**
   * Simulates the on-device bundle load: zero I/O (the bundle ships in app
   * assets), resolves immediately. Rejects with `InferenceError`
   * (`corrupt_bundle`) when the simulated bundle is corrupt.
   */
  async load(): Promise<void> {
    if (this.simulateCorruptBundle) {
      throw new InferenceError(
        'corrupt_bundle',
        'Mock metabolic bundle is corrupt (simulated).',
      );
    }
    this.loaded = true;
  }

  /**
   * Score a confirmed `MetabolicVector`. Validates the vector contract
   * (feature order, canonical units, finite values), then computes
   * `sigmoid(BIAS + Σ weight*z)` and the top-3 SHAP factors ranked by
   * |contribution| (ties broken by `MOCK_FEATURE_SPECS` order).
   */
  score(vector: MetabolicVector): Gate1AResult {
    if (!this.loaded) {
      throw new InferenceError('not_loaded', 'Call load() before score().');
    }
    this.assertVectorContract(vector);

    const contributions = MOCK_FEATURE_SPECS.map((spec, index) => {
      const raw = this.readFeature(vector, spec);
      const z = normalizeFeature(raw, spec.at0, spec.at1);
      return {index, featureKey: spec.key, contribution: z * spec.weight};
    });

    const logit = MODEL_BIAS + contributions.reduce((sum, c) => sum + c.contribution, 0);
    const probability = 1 / (1 + Math.exp(-logit));

    const shap: readonly ShapFactor[] = contributions
      .sort(
        (a, b) =>
          Math.abs(b.contribution) - Math.abs(a.contribution) || a.index - b.index,
      )
      .slice(0, SHAP_TOP_K)
      .map(c => ({featureKey: c.featureKey, contribution: c.contribution}));

    return {
      tier: tierForProbability(probability),
      probability,
      modelVersion: this.modelVersion,
      shap,
      computedAt: this.now(),
    };
  }

  /**
   * The vector contract (mirrors the ORT input tensor): exactly
   * `METABOLIC_FEATURE_ORDER.length` values in that order, each in its
   * ontology canonical unit, finite; derived/lifestyle finite; red flags
   * boolean.
   */
  private assertVectorContract(vector: MetabolicVector): void {
    if (vector.values.length !== METABOLIC_FEATURE_ORDER.length) {
      throw new InferenceError(
        'invalid_vector',
        `Expected ${METABOLIC_FEATURE_ORDER.length} lab values, got ${vector.values.length}.`,
      );
    }
    vector.values.forEach((value, i) => {
      if (value.testId !== METABOLIC_FEATURE_ORDER[i]) {
        throw new InferenceError(
          'invalid_vector',
          `values[${i}].testId '${value.testId}' breaks METABOLIC_FEATURE_ORDER ` +
            `(expected '${METABOLIC_FEATURE_ORDER[i]}').`,
        );
      }
      const entry = getEntry(value.testId);
      if (entry === undefined || entry.canonicalUnit !== value.unit) {
        throw new InferenceError(
          'invalid_vector',
          `values[${i}] (${value.testId}) must carry canonical unit ` +
            `'${entry?.canonicalUnit ?? 'unknown'}' (got '${value.unit}').`,
        );
      }
      if (!Number.isFinite(value.value)) {
        throw new InferenceError(
          'invalid_vector',
          `values[${i}] (${value.testId}) value is not finite.`,
        );
      }
    });
    for (const key of DERIVED_RATIO_KEYS) {
      if (!Number.isFinite(vector.derived[key])) {
        throw new InferenceError('invalid_vector', `derived.${key} is not finite.`);
      }
    }
    for (const key of LIFESTYLE_KEYS) {
      if (!Number.isFinite(vector.lifestyle[key])) {
        throw new InferenceError('invalid_vector', `lifestyle.${key} is not finite.`);
      }
    }
    for (const key of RED_FLAG_KEYS) {
      if (typeof vector.redFlags[key] !== 'boolean') {
        throw new InferenceError('invalid_vector', `redFlags.${key} must be a boolean.`);
      }
    }
  }

  private readFeature(vector: MetabolicVector, spec: MockFeatureSpec): number {
    switch (spec.kind) {
      case 'lab':
        return vector.values[METABOLIC_FEATURE_ORDER.indexOf(spec.key)].value;
      case 'derived':
        return vector.derived[spec.key];
      case 'lifestyle':
        return vector.lifestyle[spec.key];
      case 'redFlag':
        return vector.redFlags[spec.key] ? 1 : 0;
    }
  }
}
