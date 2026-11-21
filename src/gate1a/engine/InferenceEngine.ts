/**
 * Gate 1A — on-device inference contract (Step 6).
 *
 * V3 constraint 1 (100% on-device) & 6 (no network in model I/O): the real
 * `gate1a_metabolic.onnx` (LightGBM→ONNX) drops in behind this single
 * interface once the signed bundle exists, via the native ORT bridge:
 *   - `onnxruntime-react-native` (Android / iOS)  — TODO(native)
 *   - `onnxruntime-web` (exotic web host)         — TODO(native)
 *
 * Contract:
 *   - `load()` prepares the model bundle on-device (load weights into the
 *     on-device session). Zero network calls — the bundle ships in the app
 *     assets. Resolves once the session is ready for `score()`.
 *   - `score(vector)` is a PURE function of the `MetabolicVector`: same
 *     vector in ⇒ same `{tier, probability, modelVersion, shap}` out. No I/O,
 *     no network, no global state. The vector order matches
 *     `METABOLIC_FEATURE_ORDER` (constants.ts) — feature order is the ORT
 *     input tensor order, units are the ontology's canonical units.
 *   - The mock (`MockMetabolicModel`) and the signed-bundle path produce the
 *     EXACT same `Gate1AResult` shape so no caller changes at swap time.
 *
 * @format
 */

import type {Gate1AResult, MetabolicVector} from '../types';

/**
 * The single on-device metabolic-risk inference interface.
 * Implementations:
 *   - `MockMetabolicModel` (this step — deterministic stand-in)
 *   - `OnnxMetabolicModel` — real `gate1a_metabolic.onnx` via ORT (TODO(native))
 */
export interface InferenceEngine {
  /** Stable model-version stamp for the audit trail (e.g. 'mock-0.0.1'). */
  readonly modelVersion: string;

  /**
   * Load the on-device model session. Zero network calls (V3 constraint 1).
   * Resolves when the engine is ready to score; rejects with an
   * `InferenceError` when the bundle is missing or corrupt.
   */
  load(): Promise<void>;

  /**
   * Score a confirmed `MetabolicVector`. Pure, deterministic, <20 ms budget
   * (PERFORMANCE_BUDGETS_MS.inference). Returns a fully-shaped `Gate1AResult`
   * with tier, calibrated probability, model-version stamp, and top-3 SHAP
   * factors ranked by |contribution|.
   */
  score(vector: MetabolicVector): Gate1AResult;
}

/** Failure codes every `InferenceEngine` implementation must use. */
export type InferenceErrorCode =
  | 'not_loaded'
  | 'corrupt_bundle'
  | 'invalid_vector';

/** A model-load / score failure with a stable, UI-branchable code. */
export class InferenceError extends Error {
  readonly code: InferenceErrorCode;

  constructor(code: InferenceErrorCode, message?: string) {
    super(message ?? `Inference failed (${code})`);
    this.name = 'InferenceError';
    this.code = code;
  }
}

export function isInferenceError(error: unknown): error is InferenceError {
  return error instanceof InferenceError;
}
