/**
 * Gate 1A — thresholds, TTLs, and program constants (Step 2).
 *
 * All values here are on-device only. Tier cut points are placeholders
 * pending the signed bundle's config.json (V3 constraint 6) — the mock
 * model (Step 6) and the bundle both read THIS table until then.
 *
 * @format
 */

/**
 * Closed biomarker set, in model-feature order: `MetabolicVector.values[i].testId
 * === METABOLIC_FEATURE_ORDER[i]`. Exactly 6 entries; panel closure is
 * enforced by ontology.ts.
 */
export const METABOLIC_FEATURE_ORDER = [
  'hba1c',
  'fasting_glucose',
  'triglycerides',
  'hdl',
  'total_cholesterol',
  'hs_crp',
] as const;

export type MetabolicFeatureKey = (typeof METABOLIC_FEATURE_ORDER)[number];

/** Anthropometric features (types.ts: Anthropometrics), in vector order. */
export const ANTHROPOMETRIC_KEYS = ['height_cm', 'weight_kg', 'waist_cm'] as const;

/** Derived ratio features (types.ts: DerivedRatios), in vector order. */
export const DERIVED_RATIO_KEYS = ['bmi', 'whtr', 'tyg_index'] as const;

/** Numeric lifestyle features (types.ts: LifestyleFields), in vector order. */
export const LIFESTYLE_KEYS = [
  'age_years',
  'exercise_minutes_per_week',
  'alcohol_drinks_per_week',
  'sleep_hours_per_night',
] as const;

/** The 3 red-flag booleans (types.ts: RedFlags), in vector order. */
export const RED_FLAG_KEYS = [
  'smoking',
  'hypertension',
  'family_history_t2d',
] as const;

/**
 * OCR confidence gate (V3 constraint 2): per-value confidence ≥ this
 * threshold ⇒ `source:'ocr'`; below it the value is flagged for manual
 * confirmation (Step 5).
 */
export const OCR_CONFIDENCE_GATE = 0.75;

/** Encrypted-store TTL (V3 constraint 4): 30 days from confirmedAt. */
export const DATA_TTL_DAYS = 30;
export const DATA_TTL_MS = DATA_TTL_DAYS * 86_400_000;

/** Voucher (V3 constraint 5): program code + 30-day expiry. */
export const VOUCHER_PROGRAM_CODE = 'NAFAS-G1A-HORMONE-T2';
export const VOUCHER_TTL_DAYS = 30;
export const VOUCHER_TTL_MS = VOUCHER_TTL_DAYS * 86_400_000;
/** Bearer token size: 32 random bytes → 64 hex chars. */
export const VOUCHER_TOKEN_HEX_LENGTH = 64;

/**
 * Tier cut points on the calibrated probability, placeholders pending the
 * signed bundle's config.json: p < elevated ⇒ LOW, < high ⇒ ELEVATED,
 * else HIGH.
 */
export const TIER_CUT_POINTS = {
  elevated: 0.4,
  high: 0.7,
} as const;

/**
 * Performance budgets in ms (V3 constraint 8). Documented and enforced in
 * the mocks (Steps 4/6/7).
 */
export const PERFORMANCE_BUDGETS_MS = {
  ocrPerPageMin: 1000,
  ocrPerPageMax: 3000,
  inference: 20,
  shap: 50,
  endToEnd: 10_000,
} as const;

/** Output framing (V3 constraint 7) — shown on ResultScreen. */
export const SCREENING_DISCLAIMER =
  'This is a screening estimate, not a diagnosis.';
