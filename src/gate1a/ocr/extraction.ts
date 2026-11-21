/**
 * Gate 1A — on-device OCR extraction pipeline (Step 5).
 *
 * Pure, deterministic, 100% on-device (V3 constraint 1): takes the structured,
 * buffer-free `OcrResult` produced by Step 4 and turns it into canonical-unit
 * lab values the human-in-the-loop confirmation screen can show. No network,
 * no I/O, no raw image/PDF buffer anywhere — the input is text lines only and
 * nothing here retains a URI or byte payload (V3 constraint 3).
 *
 * Per line:
 *   1. Closed-panel match (ontology.ts: matchAlias) — longest alias, EN + AR.
 *      Non-panel lines (ALT, creatinine, albumin, headers) are dropped
 *      silently.
 *   2. Numeric value + unit parsed from the SAME line, tolerant of spaces,
 *      `:` / `|` / `–` separators, Arabic-Indic digits ٠-٩, and decimal
 *      commas/dots.
 *   3. Unit normalized + converted to the ontology canonical unit (SI →
 *      canonical, e.g. mmol/L → mg/dL for glucose).
 *
 * Quality & safety flags (V3 constraint 2 — human-in-the-loop boundary):
 *   - lowConfidence: line confidence < OCR_CONFIDENCE_GATE (0.75).
 *   - outOfBounds:   value outside a physiological sanity window (not the
 *                     tight reference range — a genuinely elevated patient
 *                     must still confirm normally). Catches OCR digit typos
 *                     like "HbA1c 58%" where 58 is physically impossible.
 *   - requiresManualFallback: true if any extracted value is low-confidence
 *     or out-of-bounds, or any required core biomarker is missing.
 *
 * A biomarker on multiple lines keeps the highest-confidence valid match.
 * `ExtractionResult` mirrors the store's `OcrExtraction` contract (values /
 * missing / fallback) so Step 10/11 consume it with no adapter.
 *
 * @format
 */

import {METABOLIC_FEATURE_ORDER, OCR_CONFIDENCE_GATE} from '../constants';
import {convertToCanonical, matchAlias} from '../ontology';
import type {OcrLine} from '../types';
import type {OcrResult} from './LabOCR';

/**
 * The closed, required biomarker set. A missing one of these (no line matched)
 * drives the whole screen to the manual-entry fallback — the 6 model-feature
 * ids, in order.
 */
export const REQUIRED_BIOMARKERS: readonly string[] = METABOLIC_FEATURE_ORDER;

/**
 * Physiological sanity windows per closed-panel test, in the CANONICAL unit.
 * These are deliberately WIDER than the ontology reference range: the
 * reference range denotes *normal* (used for scoring/explain), while this
 * window denotes *physically plausible*. A real elevated value (HbA1c 8.2%,
 * glucose 165 mg/dL) sits inside the window and confirms normally; an OCR
 * digit typo (HbA1c 58%, glucose 1650 mg/dL) falls outside and is flagged so
 * the human re-enters it.
 */
const PHYSIOLOGICAL_BOUNDS: Readonly<Record<string, {low: number; high: number}>> =
  {
    hba1c: {low: 3, high: 20}, // % — 58 is an impossible typo
    fasting_glucose: {low: 20, high: 600}, // mg/dL — 20 (hypo) … 600 (DKA)
    triglycerides: {low: 10, high: 1000}, // mg/dL — severe hypertriglyceridemia
    hdl: {low: 5, high: 150}, // mg/dL
    total_cholesterol: {low: 50, high: 500}, // mg/dL
    hs_crp: {low: 0, high: 200}, // mg/L — acute-phase up to ~200
  };

/**
 * Per-extracted-value quality/safety flags. Both booleans default false; any
 * true flag marks the value for closer human review on the confirm screen.
 */
export interface ExtractedValueFlags {
  /** Line confidence below OCR_CONFIDENCE_GATE (0.75). */
  readonly lowConfidence: boolean;
  /** Value outside the physiological sanity window (OCR-typo candidate). */
  readonly outOfBounds: boolean;
}

/** One structured, unconfirmed extracted value (canonical unit). */
export interface ExtractedValue {
  readonly testId: string;
  /** Value in the ontology canonical unit for this test. */
  readonly value: number;
  /** Canonical unit string. */
  readonly unit: string;
  /** The raw OCR line confidence in [0,1]. */
  readonly confidence: number;
  readonly flags: ExtractedValueFlags;
}

/**
 * Structured extraction output. Mirrors the store's `OcrExtraction`
 * (values / missing / fallback) plus the plan-named `requiresManualFallback`
 * boolean (kept as an alias of `fallback` so both consumers work).
 */
export interface ExtractionResult {
  /** Extracted panel values, one per matched biomarker (≤6). */
  readonly values: readonly ExtractedValue[];
  /** Required biomarkers present on no line (panel closure is silent). */
  readonly missing: readonly string[];
  /** Alias of `requiresManualFallback` for the store's `fallback` field. */
  readonly fallback: boolean;
  /** True ⇒ the whole screen should drop to the manual-entry form. */
  readonly requiresManualFallback: boolean;
}

/**
 * Map Eastern/Arabic-Indic digit forms to Western ASCII:
 *   ٠-٩ (U+0660–U+0669) & ۰-۹ (U+06F0–U+06F9) → 0-9,
 *   ، (U+060C Arabic comma) / ٫ (U+066B decimal separator) → '.' (decimal point),
 *   ٬ (U+066C thousand) → ','.
 */
function toWesternDigits(s: string): string {
  return s
    .replace(/[٠-٩۰-۹]/g, ch => {
      const code = ch.codePointAt(0) as number;
      return String(code <= 0x0669 ? code - 0x0660 : code - 0x06f0);
    })
    .replace(/[،٫]/g, '.')
    .replace(/٬/g, ',');
}

/**
 * Parse a numeric literal out of a cleaned token. Handles `5.4`, `5,4`
 * (decimal comma), `.9`, `1200`, and Western/Arabic decimal + thousands
 * separators. Returns the parsed number or `NaN` when no sane number.
 */
export function parseNumber(raw: string): number {
  let t = toWesternDigits(raw).trim();
  if (t === '') {
    return NaN;
  }
  if (t.includes('.')) {
    // A real decimal point: commas (if any) are thousands separators.
    t = t.replace(/,/g, '');
  } else if (t.includes(',')) {
    const parts = t.split(',');
    if (parts.length === 2) {
      // Exactly one comma and no dot ⇒ decimal comma ("5,4" → 5.4).
      t = parts.join('.');
    } else {
      // Multiple commas ⇒ thousands ("1,234,567" → 1234567).
      t = t.replace(/,/g, '');
    }
  }
  if (t.endsWith('.')) {
    t = t.slice(0, -1);
  }
  if (t === '' || t === '.' || t === '-') {
    return NaN;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Ordered unit tokens (longest/most-specific first) so the first match wins
 * ("mg/dL" beats a bare "mg", "mmol/L" beats "mmol").
 */
const UNIT_TOKENS: readonly string[] = [
  'mmol/L',
  'mg/dL',
  'mg/L',
  'umol/L',
  'µmol/L',
  'IU/mL',
  'IU/dL',
  'IU/L',
  'g/L',
  'g/dL',
  'U/L',
  'mmol',
  'mg',
  '%',
];

/**
 * Split a cleaned line into the numeric value and its unit. The unit is the
 * earliest known unit token; the value is the numeric literal immediately
 * preceding it (value always precedes unit in the fixtures). Returns
 * `{value, unit}` or `null` when no parseable number is present.
 */
function parseValueUnit(
  cleaned: string,
): {value: number; unit: string} | null {
  // Unit = the known token with the smallest index.
  let unit: string | null = null;
  let unitIndex = -1;
  for (const tok of UNIT_TOKENS) {
    const at = cleaned.indexOf(tok);
    if (at !== -1 && (unitIndex === -1 || at < unitIndex)) {
      unit = tok;
      unitIndex = at;
    }
  }

  const numRe = /-?\d+(?:\.\d+)?/g;
  const numbers: {value: number; index: number}[] = [];
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(cleaned)) !== null) {
    const n = parseNumber(m[0]);
    if (Number.isFinite(n)) {
      numbers.push({value: n, index: m.index});
    }
  }
  if (numbers.length === 0) {
    return null;
  }

  if (unit === null) {
    // No recognizable unit — cannot safely convert; caller drops the value.
    return {value: numbers[0].value, unit: ''};
  }
  const beforeUnit = numbers
    .filter(n => n.index < unitIndex)
    .sort((a, b) => b.index - a.index);
  if (beforeUnit.length > 0) {
    return {value: beforeUnit[0].value, unit};
  }
  // No number before the unit (e.g. unit first) — best effort: first number.
  return {value: numbers[0].value, unit};
}

/**
 * Clean an OCR line for parsing: normalize Arabic-Indic digits/separators,
 * collapse `|` / `–` / `—` / `~` to single spaces, and compress whitespace.
 */
function cleanLine(text: string): string {
  return toWesternDigits(text)
    .replace(/[|–—~·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract a single panel value from one OCR line, or `null` when the line
 * does not match the closed panel or carries no parseable number + unit.
 */
export function extractLine(line: OcrLine): ExtractedValue | null {
  const entry = matchAlias(line.text);
  if (entry === null) {
    return null; // closed panel: non-biomarker line dropped silently
  }

  const cleaned = cleanLine(line.text);
  const parsed = parseValueUnit(cleaned);
  if (parsed === null || Number.isNaN(parsed.value)) {
    return null;
  }

  // Convert to canonical unit; an unknown unit ⇒ NaN ⇒ drop the value.
  const canonicalValue = convertToCanonical(entry, parsed.value, parsed.unit);
  if (Number.isNaN(canonicalValue)) {
    return null;
  }

  const lowConfidence = line.confidence < OCR_CONFIDENCE_GATE;
  const bounds = PHYSIOLOGICAL_BOUNDS[entry.testId];
  const outOfBounds =
    bounds !== undefined &&
    (canonicalValue < bounds.low || canonicalValue > bounds.high);

  return {
    testId: entry.testId,
    value: canonicalValue,
    unit: entry.canonicalUnit,
    confidence: line.confidence,
    flags: {lowConfidence, outOfBounds},
  };
}

/**
 * Run the full extraction pipeline over an `OcrResult`.
 *
 * - Duplicates: the highest-confidence valid match for a biomarker wins.
 * - Panel closure: only the 6 closed ids are ever produced.
 * - `missing`: required biomarkers with no valid match.
 * - `requiresManualFallback`: any low-confidence value, any out-of-bounds
 *   value, or any missing required biomarker.
 *
 * Pure function — no network, no I/O, no buffer retained.
 */
export function extractValues(ocr: OcrResult): ExtractionResult {
  const best = new Map<string, ExtractedValue>();
  let hasLowConfidence = false;
  let hasOutOfBounds = false;

  for (const page of ocr.pages) {
    for (const line of page.lines) {
      const v = extractLine(line);
      if (v === null) {
        continue;
      }
      if (v.flags.lowConfidence) {
        hasLowConfidence = true;
      }
      if (v.flags.outOfBounds) {
        hasOutOfBounds = true;
      }
      const prev = best.get(v.testId);
      // Keep the highest-confidence match; ties keep the first seen.
      if (prev === undefined || v.confidence > prev.confidence) {
        best.set(v.testId, v);
      }
    }
  }

  const values: ExtractedValue[] = [];
  for (const id of REQUIRED_BIOMARKERS) {
    const v = best.get(id);
    if (v !== undefined) {
      values.push(v);
    }
  }

  const missing = REQUIRED_BIOMARKERS.filter(id => best.get(id) === undefined);
  const requiresManualFallback =
    hasLowConfidence || hasOutOfBounds || missing.length > 0;

  return {
    values,
    missing,
    fallback: requiresManualFallback,
    requiresManualFallback,
  };
}
