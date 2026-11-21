/**
 * Step 5 unit tests: on-device OCR extraction pipeline (extraction.ts).
 *
 * Table-driven + fixture-driven coverage:
 *   - parseNumber: Western/Arabic-Indic digits, decimal comma/dot, .9, 1200.
 *   - extractLine: good / low-confidence / unknown-unit / Arabic-only /
 *     out-of-range OCR typo.
 *   - extractValues wired to MockLabOCRService (Step 4) for all 3 readable
 *     fixtures: IFHAS bilingual mmol/L → accurate canonical values; mg/dL
 *     elevated → accurate canonical values (plausible, no fallback); noisy
 *     sub-0.75 scan → requiresManualFallback.
 *   - Edge cases: duplicate line (highest-confidence wins), out-of-range
 *     typo (HbA1c 58% flagged + fallback), panel closure (non-panel only).
 *
 * @format
 */

import {OCR_CONFIDENCE_GATE} from '../constants';
import type {OcrLine} from '../types';
import type {OcrResult} from './LabOCR';
import {
  extractLine,
  extractValues,
  parseNumber,
  REQUIRED_BIOMARKERS,
  type ExtractedValue,
  type ExtractionResult,
} from './extraction';
import {MOCK_FIXTURE_URIS, MockLabOCRService} from './MockLabOCRService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a positioned OCR line with a throwaway bounding box. */
function mkLine(text: string, confidence: number): OcrLine {
  return {text, confidence, box: {x: 0, y: 0, w: 10, h: 10}};
}

/** Wrap lines in a minimal, buffer-free single-page OcrResult. */
function mkOcrResult(lines: OcrLine[]): OcrResult {
  return {
    pages: [{pageIndex: 0, lines}],
    metadata: {
      engine: 'mock',
      engineVersion: '0',
      pageCount: 1,
      durationMs: 0,
    },
  };
}

/** Find a value by testId, asserting it is present. */
function val(result: ExtractionResult, testId: string): ExtractedValue {
  const v = result.values.find(x => x.testId === testId);
  expect(v).toBeDefined();
  return v!;
}

const fast = (): MockLabOCRService => new MockLabOCRService({latencyMs: 0});

// ---------------------------------------------------------------------------
// parseNumber — digit/separator normalization
// ---------------------------------------------------------------------------

describe('parseNumber', () => {
  it.each([
    ['5.4', 5.4],
    ['8.2', 8.2],
    ['0.8', 0.8],
    ['1200', 1200],
    ['.9', 0.9],
    ['5,4', 5.4], // decimal comma
    ['8,2', 8.2], // decimal comma
    ['1,234.5', 1234.5], // Western thousands + decimal
    ['٥٫٤', 5.4], // Arabic-Indic digits + Arabic decimal
    ['٥٤', 54], // Arabic-Indic digits
    ['٥،٤', 5.4], // Arabic-Indic digits + Arabic comma decimal
    ['۵۴', 54], // Eastern Arabic-Indic digits (U+06F0–U+06F9)
    ['۵٫۴', 5.4], // Eastern Arabic-Indic digits + Arabic decimal
    ['۵،۴', 5.4], // Eastern Arabic-Indic digits + Arabic comma decimal
    ['4.6', 4.6],
    ['165', 165],
  ])('parses %j → %f', (raw, expected) => {
    expect(parseNumber(raw)).toBeCloseTo(expected, 6);
  });

  it('returns NaN for empty / unit-garbage tokens', () => {
    expect(Number.isNaN(parseNumber(''))).toBe(true);
    expect(Number.isNaN(parseNumber('  '))).toBe(true);
    expect(Number.isNaN(parseNumber('.'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractLine — single-line behaviour
// ---------------------------------------------------------------------------

describe('extractLine', () => {
  it('matches a good EN line and converts to the canonical unit', () => {
    const v = extractLine(mkLine('Fasting Glucose: 4.6 mmol/L', 0.95));
    expect(v).not.toBeNull();
    expect(v!.testId).toBe('fasting_glucose');
    expect(v!.value).toBeCloseTo(4.6 * 18.0182, 6);
    expect(v!.unit).toBe('mg/dL');
    expect(v!.flags).toEqual({lowConfidence: false, outOfBounds: false});
  });

  it('flags a low-confidence line (below the 0.75 gate)', () => {
    const v = extractLine(mkLine('HbA1c: 5.4 %', 0.6));
    expect(v).not.toBeNull();
    expect(v!.flags.lowConfidence).toBe(true);
  });

  it('drops a panel line with an unknown (unconvertible) unit', () => {
    // hba1c only knows '%'; "g/L" is not in its conversion map ⇒ NaN ⇒ drop.
    expect(extractLine(mkLine('HbA1c: 5.4 g/L', 0.95))).toBeNull();
  });

  it('matches an Arabic-only line (no Latin script)', () => {
    // 'السكر التراكمي' is the Arabic alias for hba1c.
    const v = extractLine(mkLine('السكر التراكمي: 5.4 %', 0.95));
    expect(v).not.toBeNull();
    expect(v!.testId).toBe('hba1c');
    expect(v!.value).toBeCloseTo(5.4, 6);
  });

  it('flags an out-of-range OCR typo (HbA1c 58% is physically impossible)', () => {
    const v = extractLine(mkLine('HbA1c: 58 %', 0.95));
    expect(v).not.toBeNull();
    expect(v!.value).toBeCloseTo(58, 6);
    expect(v!.flags.outOfBounds).toBe(true);
  });

  it('drops a non-panel line (closed panel)', () => {
    expect(extractLine(mkLine('ALT (SGPT): 28 U/L', 0.95))).toBeNull();
    expect(extractLine(mkLine('Creatinine: 72 umol/L', 0.95))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractValues + MockLabOCRService — the 3 readable fixtures (Step 4)
// ---------------------------------------------------------------------------

describe('extractValues — IFHAS bilingual mmol/L fixture', () => {
  it('produces accurate canonical values, no fallback (clean scan)', async () => {
    const ocr = await fast().recognizePdf(MOCK_FIXTURE_URIS.ifhasBilingualMmolL);
    const result = extractValues(ocr);

    // All 6 closed-panel biomarkers extracted; non-panel lines dropped.
    expect(result.values).toHaveLength(6);
    expect(result.missing).toEqual([]);
    expect(result.requiresManualFallback).toBe(false);
    expect(result.fallback).toBe(false);

    // Accurate canonical values (SI → canonical conversion).
    expect(val(result, 'hba1c').value).toBeCloseTo(5.4, 6);
    expect(val(result, 'fasting_glucose').value).toBeCloseTo(
      4.6 * 18.0182,
      6,
    );
    expect(val(result, 'fasting_glucose').unit).toBe('mg/dL');
    expect(val(result, 'triglycerides').value).toBeCloseTo(1.2 * 88.57, 6);
    expect(val(result, 'hdl').value).toBeCloseTo(1.1 * 38.67, 6);
    expect(val(result, 'total_cholesterol').value).toBeCloseTo(
      4.4 * 38.67,
      6,
    );
    expect(val(result, 'hs_crp').value).toBeCloseTo(0.8, 6);
    expect(val(result, 'hs_crp').unit).toBe('mg/L');

    // Clean scan: no flags on any value.
    for (const v of result.values) {
      expect(v.flags).toEqual({lowConfidence: false, outOfBounds: false});
    }
  });
});

describe('extractValues — mg/dL elevated-risk fixture', () => {
  it('converts the elevated profile to canonical values without fallback', async () => {
    const ocr = await fast().recognizePdf(MOCK_FIXTURE_URIS.elevatedRiskMgdl);
    const result = extractValues(ocr);

    expect(result.values).toHaveLength(6);
    expect(result.missing).toEqual([]);
    // A genuinely elevated (but plausible) patient confirms normally — the
    // manual fallback is reserved for low confidence / impossible values.
    expect(result.requiresManualFallback).toBe(false);

    // Accurate canonical values (mg/dL is already canonical for most).
    expect(val(result, 'hba1c').value).toBeCloseTo(8.2, 6);
    expect(val(result, 'fasting_glucose').value).toBe(165);
    expect(val(result, 'triglycerides').value).toBe(240);
    expect(val(result, 'hdl').value).toBe(34);
    expect(val(result, 'total_cholesterol').value).toBe(230);
    expect(val(result, 'hs_crp').value).toBeCloseTo(4.5, 6);
  });
});

describe('extractValues — noisy low-confidence fixture', () => {
  it('triggers the manual-entry fallback (every line below 0.75)', async () => {
    const ocr = await fast().recognizePdf(MOCK_FIXTURE_URIS.noisyLowConfidence);
    const result = extractValues(ocr);

    // All 6 biomarkers still extracted (values present for the user to fix).
    expect(result.values).toHaveLength(6);
    expect(result.missing).toEqual([]);
    // Every extracted value is below the gate ⇒ fallback.
    for (const v of result.values) {
      expect(v.confidence).toBeLessThan(OCR_CONFIDENCE_GATE);
      expect(v.flags.lowConfidence).toBe(true);
    }
    expect(result.requiresManualFallback).toBe(true);
    expect(result.fallback).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('extractValues — edge cases', () => {
  it('keeps the highest-confidence match when a biomarker appears twice', () => {
    const result = extractValues(
      mkOcrResult([
        mkLine('HbA1c: 5.6 %', 0.95), // higher confidence wins
        mkLine('HbA1c: 5.4 %', 0.8), // duplicate, lower confidence
        mkLine('Fasting Glucose: 90 mg/dL', 0.9),
      ]),
    );
    const hba1c = val(result, 'hba1c');
    expect(hba1c.value).toBeCloseTo(5.6, 6);
    expect(hba1c.confidence).toBeCloseTo(0.95, 6);
    // The other panel biomarkers are absent ⇒ reported missing.
    expect(result.missing).toContain('hs_crp');
    expect(result.requiresManualFallback).toBe(true);
  });

  it('flags an out-of-range OCR typo and sets the manual fallback', () => {
    const result = extractValues(
      mkOcrResult([
        mkLine('HbA1c: 58 %', 0.95), // impossible value ⇒ out of bounds
        mkLine('Fasting Glucose: 1650 mg/dL', 0.95), // typo ⇒ out of bounds
        mkLine('Triglycerides: 110 mg/dL', 0.95),
        mkLine('HDL Cholesterol: 50 mg/dL', 0.95),
        mkLine('Total Cholesterol: 180 mg/dL', 0.95),
        mkLine('hs-CRP: 1.0 mg/L', 0.95),
      ]),
    );
    expect(val(result, 'hba1c').flags.outOfBounds).toBe(true);
    expect(val(result, 'fasting_glucose').flags.outOfBounds).toBe(true);
    // A plausible value is NOT flagged.
    expect(val(result, 'triglycerides').flags.outOfBounds).toBe(false);
    expect(result.requiresManualFallback).toBe(true);
  });

  it('enforces panel closure: only non-panel lines ⇒ all missing + fallback', () => {
    const result = extractValues(
      mkOcrResult([
        mkLine('ALT (SGPT): 28 U/L', 0.95),
        mkLine('Creatinine: 72 umol/L', 0.95),
        mkLine('Albumin: 44 g/L', 0.9),
        mkLine('AST (SGOT): 41 U/L', 0.9),
      ]),
    );
    expect(result.values).toEqual([]);
    expect(result.missing).toEqual([...REQUIRED_BIOMARKERS]);
    expect(result.requiresManualFallback).toBe(true);
  });

  it('reports a missing required biomarker (no line for it) as fallback', () => {
    const result = extractValues(
      mkOcrResult([
        mkLine('HbA1c: 5.4 %', 0.95),
        mkLine('Fasting Glucose: 90 mg/dL', 0.95),
        // triglycerides, hdl, total_cholesterol, hs_crp absent
      ]),
    );
    expect(result.values).toHaveLength(2);
    expect(result.missing).toEqual([
      'triglycerides',
      'hdl',
      'total_cholesterol',
      'hs_crp',
    ]);
    expect(result.requiresManualFallback).toBe(true);
  });

  it('produces a buffer-free, ordered result shape', () => {
    const result = extractValues(
      mkOcrResult([
        mkLine('hs-CRP: 1.0 mg/L', 0.95),
        mkLine('HbA1c: 5.4 %', 0.95),
      ]),
    );
    // values are emitted in REQUIRED_BIOMARKERS order regardless of line order.
    expect(result.values.map(v => v.testId)).toEqual(['hba1c', 'hs_crp']);
    // No raw bytes / URIs leak into the structured output.
    expect(JSON.stringify(result)).not.toMatch(/base64|buffer|binary|file:\/\//i);
  });
});
