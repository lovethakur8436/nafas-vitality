/**
 * Gate 1A — platform-agnostic on-device OCR contract (Step 4).
 *
 * V3 constraint 1 (100% on-device): `LabOCR` is the single boundary behind
 * which the real native engines drop in later, each fully offline:
 *   - Android: ML Kit Text Recognition v2 (bundled model, no network)
 *     — TODO(native)
 *   - iOS: Apple Vision `VNRecognizeTextRequest` (Arabic + Latin)
 *     — TODO(native)
 *
 * Contract:
 *   - `recognizePdf(uri)` resolves to an `OcrResult` carrying ONLY extracted
 *     text lines, per-line confidence, bounding boxes, and run metadata. It
 *     NEVER carries raw image or PDF bytes (V3 constraint 3) — no buffer, no
 *     base64, no uri in the result.
 *   - `purge(uri)` is called by the caller right after parse + confirm and
 *     must be idempotent (a missing file is not an error).
 *   - Failures surface as `OcrError` with a stable code.
 *
 * `recognizePdf` is Promise-based so the async native engines and the
 * deterministic mock (`MockLabOCRService`) share one signature.
 *
 * @format
 */

import type {OcrPage} from '../types';

/** Structured, buffer-free OCR output for one PDF. */
export interface OcrResult {
  /** Positioned text lines with per-line confidence (types.ts: OcrPage). */
  readonly pages: readonly OcrPage[];
  readonly metadata: OcrRunMetadata;
}

/** Run metadata for the on-device audit trail (no PII, no bytes). */
export interface OcrRunMetadata {
  /** Stable engine id: 'mock', 'mlkit-text-v2', 'apple-vision'. */
  readonly engine: string;
  /** Engine/bundle version stamp. */
  readonly engineVersion: string;
  readonly pageCount: number;
  /**
   * Wall-clock ms for the whole run. The mock reports the simulated
   * (deterministic) run time; real engines report measured time. Both stay
   * within the 1–3 s per-page budget (constants.ts: PERFORMANCE_BUDGETS_MS).
   */
  readonly durationMs: number;
}

/** Failure codes every `LabOCR` implementation must use. */
export type OcrErrorCode = 'unreadable' | 'not_found' | 'unsupported';

/** A recognition failure with a stable, UI-branchable code. */
export class OcrError extends Error {
  readonly code: OcrErrorCode;
  readonly uri: string;

  constructor(code: OcrErrorCode, uri: string, message?: string) {
    super(message ?? `OCR failed (${code}): ${uri}`);
    this.name = 'OcrError';
    this.code = code;
    this.uri = uri;
  }
}

export function isOcrError(error: unknown): error is OcrError {
  return error instanceof OcrError;
}

/**
 * The single on-device OCR interface. Implementations:
 *   - `MockLabOCRService` (this step — deterministic offline fixtures)
 *   - `MlKitLabOCR` — Android ML Kit Text Recognition v2 (TODO(native))
 *   - `VisionLabOCR` — iOS Apple Vision (TODO(native))
 */
export interface LabOCR {
  /** Stable engine id for the audit trail (e.g. 'mock'). */
  readonly engineId: string;

  /**
   * Recognize a picked lab PDF entirely on-device. Zero network calls.
   * Rejects with `OcrError` ('not_found' | 'unreadable' | 'unsupported').
   */
  recognizePdf(uri: string): Promise<OcrResult>;

  /**
   * Delete the local lab file after parse + confirm (V3 constraint 3).
   * Idempotent: purging an already-gone file is not an error.
   */
  purge(uri: string): Promise<void>;
}
