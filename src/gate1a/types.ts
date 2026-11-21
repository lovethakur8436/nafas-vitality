/**
 * Gate 1A — Passive Metabolic Radar: shared domain types.
 *
 * V3 constraint: everything here is a plain on-device data shape. No network,
 * no cloud identity, no PII beyond what the user owns on this phone.
 *
 * @format
 */

/** Canonical risk tiers produced by the Gate 1A metabolic model. */
export type RiskTier = 'LOW' | 'ELEVATED' | 'HIGH';

/**
 * How a lab value entered the vector. `ocr` means the on-device OCR engine
 * extracted it AND the user confirmed it on the confirmation screen.
 * `manual` means the user typed/edited it (including the full manual-entry
 * fallback path). The model does not distinguish — the vector is the vector —
 * but we keep the source for the on-device audit trail.
 */
export type ValueSource = 'ocr' | 'manual';

/**
 * A single confirmed lab value, ready to feed the model. `value` is in the
 * canonical unit defined by the ontology for `testId` — unit conversion
 * happens in the extraction pipeline (Step 5), never at inference time.
 */
export interface LabValue {
  /** Ontology test id, e.g. 'fasting_glucose'. */
  readonly testId: string;
  /** Numeric value in the canonical unit for this test. */
  readonly value: number;
  /** Canonical unit string, e.g. 'mg/dL'. */
  readonly unit: string;
  /** OCR confidence in [0,1]. 1.0 for manual entry (human-attested). */
  readonly confidence: number;
  readonly source: ValueSource;
  /** Epoch ms when the user confirmed/corrected this value. */
  readonly confirmedAt: number;
}

/**
 * Anthropometrics captured from the questionnaire / self-report (Step 12).
 * Feed the derived-ratio features (bmi, whtr) and the model directly.
 */
export interface Anthropometrics {
  readonly height_cm: number;
  readonly weight_kg: number;
  readonly waist_cm: number;
}

/**
 * Ratios derived on-device from anthropometrics + confirmed biomarkers
 * (inputs in canonical units). Computed by `computeDerivedRatios` in
 * ontology.ts — never by the model at inference time.
 */
export interface DerivedRatios {
  /** kg/m^2 — weight_kg / (height_m)^2. */
  readonly bmi: number;
  /** waist-to-height ratio — waist_cm / height_cm. */
  readonly whtr: number;
  /** Tyg index — (fasting_glucose_mgdl * triglycerides_mgdl) / 200. */
  readonly tyg_index: number;
}

/**
 * Numeric lifestyle-questionnaire features (Step 12 collects them).
 * Keys mirror `LIFESTYLE_KEYS` in constants.ts.
 */
export interface LifestyleFields {
  readonly age_years: number;
  readonly exercise_minutes_per_week: number;
  readonly alcohol_drinks_per_week: number;
  readonly sleep_hours_per_night: number;
}

/**
 * The 3 red-flag booleans screened by the questionnaire.
 * Keys mirror `RED_FLAG_KEYS` in constants.ts.
 */
export interface RedFlags {
  /** Current smoker (any frequency). */
  readonly smoking: boolean;
  /** Diagnosed hypertension or on BP medication. */
  readonly hypertension: boolean;
  /** First-degree relative with type 2 diabetes. */
  readonly family_history_t2d: boolean;
}

/**
 * The ordered feature vector consumed by `gate1a_metabolic.onnx`.
 *
 * Contract: `values[i].testId === METABOLIC_FEATURE_ORDER[i]` (from
 * constants.ts) and each `value` is in the ontology's canonical unit. The
 * mock model (Step 6) and the real ONNX bundle (later workstream) both read
 * this exact shape.
 */
export interface MetabolicVector {
  /** Confirmed lab values; values[i].testId === METABOLIC_FEATURE_ORDER[i]. */
  readonly values: readonly LabValue[];
  readonly anthropometrics: Anthropometrics;
  readonly derived: DerivedRatios;
  readonly lifestyle: LifestyleFields;
  readonly redFlags: RedFlags;
  /** Epoch ms the vector was assembled. Used for TTL bookkeeping. */
  readonly assembledAt: number;
  /**
   * SHA-256 (hex) of the canonical JSON of `values` + `lifestyle`.
   * Stamped on telemetry events so the vector itself is never re-sent
   * (V2 carry-over, V3: the hash is the only thing that may leave).
   */
  readonly contentHash: string;
}

/**
 * One explainable factor: a model feature's signed contribution to the
 * logit. `contribution` is in logit space (positive pushes risk up).
 * Step 7 turns the top-3 into plain-language sentences.
 */
export interface ShapFactor {
  readonly featureKey: string;
  readonly contribution: number;
}

export interface Gate1AResult {
  readonly tier: RiskTier;
  /** Calibrated probability of the positive class, in [0,1]. */
  readonly probability: number;
  /** Model bundle version this result was computed with (stamp for telemetry). */
  readonly modelVersion: string;
  readonly shap: readonly ShapFactor[];
  /** Epoch ms of the inference call. */
  readonly computedAt: number;
}

/**
 * Device-minted home hormone blood-spot voucher (Step 8).
 * Bearer code: random 256-bit token + program code + 30-day expiry.
 * No identity, no central seed, no network in minting or redemption.
 */
export interface Voucher {
  /** 32-byte (256-bit) random token, 64 hex chars. */
  readonly token: string;
  readonly programCode: string;
  readonly mintedAt: number;
  readonly expiresAt: number;
}

export interface T2ConsentRecord {
  readonly scope: 'hormone_panel';
  readonly grantedAt: number;
  readonly voucherToken: string;
}

/** State machine states — see store.ts (Step 3) for the transition table. */
export type Gate1AStateName =
  | 'IDLE'
  | 'PDF_LOADED'
  | 'OCR_RUNNING'
  | 'CONFIRMING'
  | 'MANUAL_ENTRY'
  | 'QUESTIONNAIRE'
  | 'SCORING'
  | 'RESULT'
  | 'VOUCHER_ACCEPTED';

/**
 * An on-device OCR page: positioned text lines with per-line confidence.
 * Mirrors the ML Kit v2 (Android, bundled/offline) and Apple Vision (iOS)
 * output shapes behind the single `LabOCR` interface (Step 4).
 */
export interface OcrLine {
  readonly text: string;
  /** OCR confidence for this line in [0,1]. */
  readonly confidence: number;
  /** Bounding box in page coordinates (px). */
  readonly box: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

export interface OcrPage {
  readonly pageIndex: number;
  readonly lines: readonly OcrLine[];
}
