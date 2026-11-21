/**
 * Gate 1A — deterministic offline `LabOCR` mock (Step 4).
 *
 * Stands in for the real on-device OCR engines (ML Kit Text Recognition v2
 * on Android, Apple Vision on iOS — both TODO(native)) so the whole Gate 1A
 * pipeline runs headless:
 *
 *  - Zero network calls: no fetch, no XMLHttpRequest, no file I/O. A "PDF"
 *    is a string URI keying into an in-memory table of structured text
 *    lines — all fixtures are self-contained in this file.
 *  - No raw bytes retained: `recognizePdf` returns an `OcrResult` with
 *    extracted text lines, per-line confidence, bounding boxes, and run
 *    metadata only (V3 constraint 3).
 *  - Deterministic: same URI ⇒ same pages, same per-page latency (derived
 *    from the URI via FNV-1a), same metadata. Latency is simulated inside
 *    the 1–3 s per-page budget (PERFORMANCE_BUDGETS_MS); inject `latencyMs`
 *    (0 = no sleep) in tests.
 *
 * Fixtures (all cover Step 3's 6-biomarker confirmation gate):
 *  - IFHAS bilingual (English + Arabic) UAE report, SI units (mmol/L), all 6
 *    closed-panel biomarkers plus non-panel lines to exercise closure.
 *  - Standard mg/dL elevated-risk report (high HbA1c, glucose, TG; low HDL).
 *  - Noisy scan: every biomarker line below OCR_CONFIDENCE_GATE (0.75),
 *    exercising the manual-entry fallback path.
 *  - Corrupted/unreadable PDF: recognition rejects with OcrError('unreadable').
 *
 * @format
 */

import {PERFORMANCE_BUDGETS_MS} from '../constants';
import type {OcrLine, OcrPage} from '../types';
import {OcrError, type LabOCR, type OcrResult} from './LabOCR';

/** Stable engine identifiers for the on-device audit trail (V3 constraint 8). */
export const MOCK_OCR_ENGINE_ID = 'mock';
export const MOCK_OCR_ENGINE_VERSION = '0.1.0';

/**
 * Deterministic URI keys into the fixture registry. The real native bridge
 * receives file:// URIs from the document picker; tests pass these keys.
 */
export const MOCK_FIXTURE_URIS = {
  /** Bilingual (EN+AR) UAE IFHAS-style report, SI units (mmol/L), all 6. */
  ifhasBilingualMmolL: 'file://lab/ifhas-bilingual-uae.pdf',
  /** Standard mg/dL report, elevated-risk profile. */
  elevatedRiskMgdl: 'file://lab/elevated-risk-mgdl.pdf',
  /** Noisy scan — every biomarker line below the 0.75 confidence gate. */
  noisyLowConfidence: 'file://lab/noisy-low-confidence-scan.pdf',
  /** Corrupted / unreadable PDF — recognition rejects. */
  unreadablePdf: 'file://lab/corrupted-scan.pdf',
} as const;

interface MockLine {
  readonly text: string;
  /** OCR confidence in [0,1]. */
  readonly confidence: number;
}

interface MockFixture {
  readonly pages: readonly (readonly MockLine[])[];
  /** When true, recognition rejects with OcrError('unreadable'). */
  readonly unreadable?: true;
}

const FIXTURES: Readonly<Record<string, MockFixture>> = {
  [MOCK_FIXTURE_URIS.ifhasBilingualMmolL]: {
    pages: [
      [
        {text: 'IFHAS Clinical Laboratory — Dubai, UAE', confidence: 0.97},
        {text: 'التقارير المخبرية — Metabolic Panel', confidence: 0.95},
        {
          text: 'Patient: A. Al Mansoori | DOB: 1978-03-04 | Date: 2026-11-12 | Ref: IF-2026-4471',
          confidence: 0.92,
        },
        {
          text: 'HbA1c (A1c) | السكر التراكمي | 5.4 | % | 4.0 – 5.6',
          confidence: 0.96,
        },
        {
          text: 'Fasting Glucose (FBS) | الجلوكوز الصائم | 4.6 | mmol/L | 3.9 – 5.5',
          confidence: 0.94,
        },
        {
          text: 'Triglycerides | الدهون الثلاثية | 1.2 | mmol/L | 0.45 – 1.70',
          confidence: 0.93,
        },
        {
          text: 'HDL Cholesterol | الكوليسترول الجيد | 1.1 | mmol/L | 1.04 – 1.69',
          confidence: 0.91,
        },
        {
          text: 'Total Cholesterol | الكوليسترول الكلي | 4.4 | mmol/L | 3.0 – 5.2',
          confidence: 0.92,
        },
        {
          text: 'hs-CRP | البروتين التفاعلي | 0.8 | mg/L | 0.0 – 3.0',
          confidence: 0.95,
        },
        // Non-panel lines — the closed panel must drop these in Step 5.
        {text: 'ALT (SGPT) | الأنزيم الكبدي | 28 | U/L | 0 – 35', confidence: 0.9},
        {text: 'Creatinine | الكرياتينين | 72 | umol/L | 62 – 106', confidence: 0.9},
        {text: 'Albumin | الألبومين | 44 | g/L | 35 – 50', confidence: 0.89},
        {
          text: 'Page 1 of 1 — For clinical use only | للاستخدام السريري فقط',
          confidence: 0.94,
        },
      ],
    ],
  },
  [MOCK_FIXTURE_URIS.elevatedRiskMgdl]: {
    pages: [
      [
        {
          text: 'Metabolic Health Report — City Clinic Lab',
          confidence: 0.97,
        },
        {
          text: 'Patient: S. Khan | DOB: 1981-07-19 | Date: 2026-11-10 | Ref: CC-88231',
          confidence: 0.94,
        },
        {text: 'HbA1c: 8.2 % (Ref: 4.0 – 5.6)', confidence: 0.93},
        {text: 'Fasting Glucose: 165 mg/dL (Ref: 70 – 99)', confidence: 0.91},
        {text: 'Triglycerides: 240 mg/dL (Ref: 35 – 149)', confidence: 0.9},
        {text: 'HDL Cholesterol: 34 mg/dL (Ref: 40 – 60)', confidence: 0.88},
        {text: 'Total Cholesterol: 230 mg/dL (Ref: 125 – 200)', confidence: 0.9},
        {text: 'hs-CRP: 4.5 mg/L (Ref: 0 – 3.0)', confidence: 0.95},
        {text: 'AST (SGOT): 41 U/L (Ref: 0 – 37)', confidence: 0.86},
      ],
    ],
  },
  [MOCK_FIXTURE_URIS.noisyLowConfidence]: {
    pages: [
      [
        {
          text: 'Metabolic Health Report — City Clinic Lab',
          confidence: 0.71,
        },
        {text: 'Patient: S. Khan | Date: 2026-11-10', confidence: 0.66},
        {text: 'HbA1c: 6.8 %', confidence: 0.52},
        {text: 'Fasting Glucose: 142 mg/dL', confidence: 0.48},
        {text: 'Triglycerides: 205 mg/dL', confidence: 0.41},
        {text: 'HDL Cholesterol: 38 mg/dL', confidence: 0.63},
        {text: 'Total Cholesterol: 218 mg/dL', confidence: 0.55},
        {text: 'hs-CRP: 3.9 mg/L', confidence: 0.37},
        {text: '??l Chol: 2?? mg/dL', confidence: 0.31},
      ],
    ],
  },
  [MOCK_FIXTURE_URIS.unreadablePdf]: {
    pages: [],
    unreadable: true,
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** FNV-1a 32-bit — stable, dependency-free string hash. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic bounding box in page coordinates (px), row-major layout. */
function boxFor(lineIndex: number, text: string): OcrLine['box'] {
  return {
    x: 56,
    y: 72 + lineIndex * 24,
    w: Math.min(500, Math.max(48, Math.round(text.length * 8))),
    h: 18,
  };
}

export interface MockLabOCRServiceOptions {
  /**
   * Simulated per-page recognition latency in ms. When omitted, a
   * deterministic latency inside the 1–3 s per-page budget is derived from
   * the URI (same URI ⇒ same latency). Pass 0 in tests to skip the sleep.
   */
  readonly latencyMs?: number;
}

/**
 * Deterministic offline LabOCR (Step 4). Swap for the ML Kit / Vision
 * native binding 1:1 behind the same `LabOCR` contract — no caller change.
 */
export class MockLabOCRService implements LabOCR {
  readonly engineId: string = MOCK_OCR_ENGINE_ID;

  private readonly latencyMs: number | undefined;
  private readonly purged: string[] = [];

  constructor(options: MockLabOCRServiceOptions = {}) {
    this.latencyMs = options.latencyMs;
  }

  /** URIs passed to `purge()`, in call order (test introspection). */
  get purgedUris(): readonly string[] {
    return this.purged.slice();
  }

  async recognizePdf(uri: string): Promise<OcrResult> {
    const fixture = FIXTURES[uri];
    if (fixture === undefined) {
      throw new OcrError(
        'not_found',
        uri,
        `No offline fixture is registered for '${uri}'.`,
      );
    }
    // Simulated on-device recognition: one budget window per page.
    const perPageMs = this.perPageLatencyMs(uri);
    for (let page = 0; page < fixture.pages.length; page++) {
      await sleep(perPageMs);
    }
    if (fixture.unreadable === true) {
      throw new OcrError(
        'unreadable',
        uri,
        'Fixture simulates a corrupted or non-text PDF.',
      );
    }
    const pages: OcrPage[] = fixture.pages.map((lines, pageIndex) => ({
      pageIndex,
      lines: lines.map((line, lineIndex) => ({
        text: line.text,
        confidence: line.confidence,
        box: boxFor(lineIndex, line.text),
      })),
    }));
    return {
      pages,
      metadata: {
        engine: MOCK_OCR_ENGINE_ID,
        engineVersion: MOCK_OCR_ENGINE_VERSION,
        pageCount: pages.length,
        // Deterministic simulated wall-clock of the run (within budget).
        durationMs: perPageMs * pages.length,
      },
    };
  }

  async purge(uri: string): Promise<void> {
    // The mock owns no disk file; record the call so tests can assert the
    // caller honours V3 constraint 3 (parse + confirm ⇒ purge).
    this.purged.push(uri);
  }

  private perPageLatencyMs(uri: string): number {
    if (this.latencyMs !== undefined) {
      return this.latencyMs;
    }
    const min = PERFORMANCE_BUDGETS_MS.ocrPerPageMin;
    const max = PERFORMANCE_BUDGETS_MS.ocrPerPageMax;
    return min + (fnv1a(uri) % (max - min + 1));
  }
}
