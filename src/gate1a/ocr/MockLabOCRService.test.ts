/**
 * Step 4 unit tests: LabOCR contract + MockLabOCRService.
 *
 * Covers: bilingual IFHAS mmol/L fixture (all 6 closed-panel biomarkers),
 * mg/dL elevated-risk fixture, noisy sub-0.75 scan (manual-entry fallback
 * path), unreadable-PDF + unknown-URI rejection, buffer-free result shape,
 * the 1–3 s per-page latency budget, determinism, and purge bookkeeping.
 *
 * @format
 */

import {OCR_CONFIDENCE_GATE, PERFORMANCE_BUDGETS_MS} from '../constants';
import {isOcrError, OcrError} from './LabOCR';
import {
  MOCK_FIXTURE_URIS,
  MOCK_OCR_ENGINE_ID,
  MOCK_OCR_ENGINE_VERSION,
  MockLabOCRService,
} from './MockLabOCRService';
import type {OcrLine, OcrPage} from '../types';

/** One recognizable substring per closed-panel biomarker (Step 3's 6). */
const BIOMARKER_MARKERS: ReadonlyArray<{testId: string; marker: string}> = [
  {testId: 'hba1c', marker: 'HbA1c'},
  {testId: 'fasting_glucose', marker: 'Fasting Glucose'},
  {testId: 'triglycerides', marker: 'Triglycerides'},
  {testId: 'hdl', marker: 'HDL Cholesterol'},
  {testId: 'total_cholesterol', marker: 'Total Cholesterol'},
  {testId: 'hs_crp', marker: 'hs-CRP'},
];

function findLine(
  pages: readonly OcrPage[],
  marker: string,
): OcrLine | undefined {
  return pages.flatMap(p => p.lines).find(l => l.text.includes(marker));
}

/** Pull the first numeric capture out of a line, asserting it is present. */
function num(line: OcrLine, re: RegExp): number {
  const m = line.text.match(re);
  expect(m).not.toBeNull();
  return Number(m![1]);
}

const fast = (): MockLabOCRService => new MockLabOCRService({latencyMs: 0});

describe('MockLabOCRService — IFHAS bilingual mmol/L fixture', () => {
  it('extracts all 6 closed-panel biomarkers in SI units, bilingual lines included', async () => {
    const result = await fast().recognizePdf(MOCK_FIXTURE_URIS.ifhasBilingualMmolL);

    expect(result.pages).toHaveLength(1);
    expect(result.metadata).toEqual({
      engine: MOCK_OCR_ENGINE_ID,
      engineVersion: MOCK_OCR_ENGINE_VERSION,
      pageCount: 1,
      durationMs: 0,
    });

    const texts = result.pages.flatMap(p => p.lines.map(l => l.text));
    // Bilingual: at least one line carries Arabic script.
    expect(texts.some(t => /[\u0600-\u06FF]/.test(t))).toBe(true);

    // All 6 closed-panel biomarkers present (Step 3's 6-biomarker gate).
    for (const {marker} of BIOMARKER_MARKERS) {
      expect(findLine(result.pages, marker)).toBeDefined();
    }

    // SI (mmol/L) units, as reported by the UAE IFHAS-style lab.
    expect(findLine(result.pages, 'Fasting Glucose')!.text).toContain('mmol/L');
    expect(findLine(result.pages, 'Triglycerides')!.text).toContain('mmol/L');
    expect(findLine(result.pages, 'HDL Cholesterol')!.text).toContain('mmol/L');
    expect(findLine(result.pages, 'Total Cholesterol')!.text).toContain('mmol/L');
    expect(findLine(result.pages, 'HbA1c')!.text).toContain('%');
    expect(findLine(result.pages, 'hs-CRP')!.text).toContain('mg/L');

    // Non-panel lines are in the report too (closure enforced in Step 5).
    expect(texts.some(t => t.includes('ALT (SGPT)'))).toBe(true);
    expect(texts.some(t => t.includes('Creatinine'))).toBe(true);

    // Clean scan: every biomarker line at/above the 0.75 gate.
    for (const {marker} of BIOMARKER_MARKERS) {
      expect(findLine(result.pages, marker)!.confidence).toBeGreaterThanOrEqual(
        OCR_CONFIDENCE_GATE,
      );
    }
  });
});

describe('MockLabOCRService — mg/dL elevated-risk fixture', () => {
  it('carries the elevated-risk profile in mg/dL', async () => {
    const result = await fast().recognizePdf(MOCK_FIXTURE_URIS.elevatedRiskMgdl);
    const line = (marker: string): OcrLine => findLine(result.pages, marker)!;

    // High HbA1c, high fasting glucose, high TG, low HDL — plus TC and CRP.
    expect(num(line('HbA1c'), /([\d.]+)\s*%/)).toBeGreaterThan(5.6); // > ref high
    expect(num(line('Fasting Glucose'), /([\d.]+)\s*mg\/dL/)).toBeGreaterThan(99);
    expect(num(line('Triglycerides'), /([\d.]+)\s*mg\/dL/)).toBeGreaterThan(149);
    expect(num(line('HDL Cholesterol'), /([\d.]+)\s*mg\/dL/)).toBeLessThan(40);
    expect(line('Total Cholesterol').text).toMatch(/230\s*mg\/dL/);
    expect(line('hs-CRP').text).toMatch(/4\.5\s*mg\/L/);

    // Standard mg/dL units on the lipid/glucose lines.
    expect(line('Fasting Glucose').text).toContain('mg/dL');
    expect(line('Triglycerides').text).toContain('mg/dL');

    // All biomarker lines at/above the 0.75 gate.
    for (const {marker} of BIOMARKER_MARKERS) {
      expect(line(marker).confidence).toBeGreaterThanOrEqual(OCR_CONFIDENCE_GATE);
    }
  });
});

describe('MockLabOCRService — noisy / low-confidence fixture', () => {
  it('reports every biomarker line below the 0.75 gate (manual-entry fallback)', async () => {
    const result = await fast().recognizePdf(MOCK_FIXTURE_URIS.noisyLowConfidence);

    for (const {marker} of BIOMARKER_MARKERS) {
      const line = findLine(result.pages, marker);
      expect(line).toBeDefined();
      expect(line!.confidence).toBeLessThan(OCR_CONFIDENCE_GATE);
    }
    // At least one garbled line below 0.4.
    expect(result.pages.some(p => p.lines.some(l => l.confidence < 0.4))).toBe(true);
  });
});

describe('MockLabOCRService — error paths', () => {
  it('rejects the unreadable PDF fixture with OcrError(unreadable)', async () => {
    let caught: unknown;
    try {
      await fast().recognizePdf(MOCK_FIXTURE_URIS.unreadablePdf);
    } catch (e) {
      caught = e;
    }
    expect(isOcrError(caught)).toBe(true);
    expect((caught as OcrError).code).toBe('unreadable');
    expect((caught as OcrError).uri).toBe(MOCK_FIXTURE_URIS.unreadablePdf);
  });

  it('rejects unknown URIs with OcrError(not_found)', async () => {
    let caught: unknown;
    try {
      await fast().recognizePdf('file://lab/does-not-exist.pdf');
    } catch (e) {
      caught = e;
    }
    expect(isOcrError(caught)).toBe(true);
    expect((caught as OcrError).code).toBe('not_found');
  });
});

describe('MockLabOCRService — buffer-free result contract', () => {
  it('returns only structured text + metadata — no raw bytes, buffers, or URIs', async () => {
    const result = await fast().recognizePdf(MOCK_FIXTURE_URIS.ifhasBilingualMmolL);

    expect(Object.keys(result).sort()).toEqual(['metadata', 'pages']);
    for (const page of result.pages) {
      expect(Object.keys(page).sort()).toEqual(['lines', 'pageIndex']);
      for (const line of page.lines) {
        expect(Object.keys(line).sort()).toEqual(['box', 'confidence', 'text']);
        expect(Object.keys(line.box).sort()).toEqual(['h', 'w', 'x', 'y']);
        expect(line.box.x).toBeGreaterThanOrEqual(0);
        expect(line.box.y).toBeGreaterThanOrEqual(0);
        expect(line.box.w).toBeGreaterThan(0);
        expect(line.box.h).toBeGreaterThan(0);
        expect(line.confidence).toBeGreaterThanOrEqual(0);
        expect(line.confidence).toBeLessThanOrEqual(1);
      }
    }
    // No binary payload anywhere in the serialized result.
    expect(JSON.stringify(result)).not.toMatch(/base64|buffer|binary|dataurl/i);
  });
});

describe('MockLabOCRService — performance budget (V3 constraint 8)', () => {
  it('simulates 1–3 s per page with the default options', async () => {
    const min = PERFORMANCE_BUDGETS_MS.ocrPerPageMin;
    const max = PERFORMANCE_BUDGETS_MS.ocrPerPageMax;
    const t0 = Date.now();
    const result = await new MockLabOCRService().recognizePdf(
      MOCK_FIXTURE_URIS.ifhasBilingualMmolL,
    );
    const elapsed = Date.now() - t0;

    // 1-page fixture ⇒ simulated run time inside the per-page budget.
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(min);
    expect(result.metadata.durationMs).toBeLessThanOrEqual(max);
    // Measured wall-clock tracks the simulated time (plus timer slack).
    expect(elapsed).toBeGreaterThanOrEqual(min - 25);
    expect(elapsed).toBeLessThanOrEqual(result.metadata.durationMs + 500);
  });
});

describe('MockLabOCRService — determinism & purge', () => {
  it('returns identical pages and metadata for the same URI', async () => {
    const svc = new MockLabOCRService({latencyMs: 1234});
    const a = await svc.recognizePdf(MOCK_FIXTURE_URIS.elevatedRiskMgdl);
    const b = await svc.recognizePdf(MOCK_FIXTURE_URIS.elevatedRiskMgdl);
    expect(b.pages).toEqual(a.pages);
    expect(b.metadata).toEqual(a.metadata);
    expect(a.metadata.durationMs).toBe(1234 * a.pages.length);
  });

  it('records purge() calls and keeps recognition working afterwards', async () => {
    const svc = fast();
    const uri = MOCK_FIXTURE_URIS.noisyLowConfidence;
    await svc.purge(uri);
    await svc.purge(uri);
    expect(svc.purgedUris).toEqual([uri, uri]);
    // Structured text is in-memory: purge only clears the (mock) disk handle.
    expect((await svc.recognizePdf(uri)).pages).toHaveLength(1);
  });
});
