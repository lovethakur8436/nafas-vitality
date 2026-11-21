/**
 * Gate 1A — closed IFHAS-style metabolic panel (Step 2).
 *
 * The panel is CLOSED: only the 6 test ids below are ever extracted. Anything
 * not matching an alias is dropped by the extraction pipeline (Step 5) —
 * no bilirubin, ALT, AST, BUN, creatinine, uric acid, or any other test.
 *
 * Each entry carries display name, name aliases (Latin + Arabic script),
 * canonical unit, an SI→canonical conversion map, and a reference range.
 *
 * @format
 */

import type { Anthropometrics, DerivedRatios } from './types';

export interface ReferenceRange {
  readonly low: number;
  readonly high: number;
}

export interface OntologyEntry {
  /** Canonical test id used by LabValue.testId and METABOLIC_FEATURE_ORDER. */
  readonly testId: string;
  /** Human-facing name shown on the confirm screen. */
  readonly displayName: string;
  /**
   * Name aliases in both scripts. Matching (matchAlias) normalizes case and
   * non-alphanumeric characters (Latin + Arabic) before substring compare;
   * when several aliases hit, the LONGEST alias wins (disambiguates
   * "HDL Cholesterol" vs "Total Cholesterol").
   */
  readonly aliases: readonly string[];
  /** Canonical unit the model consumes. */
  readonly canonicalUnit: string;
  /** Multiplier per unit string, mapping that unit → canonicalUnit. */
  readonly conversionToCanonical: Readonly<Record<string, number>>;
  /** Reference range in the canonical unit (adult, screening use). */
  readonly referenceRange: ReferenceRange;
}

export const ONTOLOGY: readonly OntologyEntry[] = [
  {
    testId: 'hba1c',
    displayName: 'HbA1c',
    aliases: [
      'HbA1c',
      'A1C',
      'Hemoglobin A1c',
      'Glycated Hemoglobin',
      'السكر التراكمي',
      'هيموغلوبين A1c',
    ],
    canonicalUnit: '%',
    conversionToCanonical: {'%': 1},
    referenceRange: {low: 4.0, high: 5.6},
  },
  {
    testId: 'fasting_glucose',
    displayName: 'Fasting Glucose',
    aliases: [
      'Fasting Glucose',
      'Glucose Fasting',
      'Glucose',
      'FBS',
      'الجلوكوز الصائم',
      'سكر الصيام',
    ],
    canonicalUnit: 'mg/dL',
    conversionToCanonical: {'mg/dL': 1, 'mmol/L': 18.0182},
    referenceRange: {low: 70, high: 99},
  },
  {
    testId: 'triglycerides',
    displayName: 'Triglycerides',
    aliases: ['Triglycerides', 'TG', 'الدهون الثلاثية'],
    canonicalUnit: 'mg/dL',
    conversionToCanonical: {'mg/dL': 1, 'mmol/L': 88.57},
    referenceRange: {low: 35, high: 149},
  },
  {
    testId: 'hdl',
    displayName: 'HDL Cholesterol',
    aliases: [
      'HDL Cholesterol',
      'HDL',
      'High Density Lipoprotein',
      'الكوليسترول الجيد',
      'البروتين عالي الكثافة',
    ],
    canonicalUnit: 'mg/dL',
    conversionToCanonical: {'mg/dL': 1, 'mmol/L': 38.67},
    referenceRange: {low: 40, high: 60},
  },
  {
    testId: 'total_cholesterol',
    displayName: 'Total Cholesterol',
    aliases: [
      'Total Cholesterol',
      'Cholesterol',
      'TC',
      'الكوليسترول الكلي',
      'الكوليسترول',
    ],
    canonicalUnit: 'mg/dL',
    conversionToCanonical: {'mg/dL': 1, 'mmol/L': 38.67},
    referenceRange: {low: 125, high: 200},
  },
  {
    testId: 'hs_crp',
    displayName: 'hs-CRP',
    aliases: [
      'High Sensitivity CRP',
      'HS CRP',
      'CRP',
      'C Reactive Protein',
      'البروتين التفاعلي',
      'بروتين سي التفاعلي',
    ],
    canonicalUnit: 'mg/L',
    conversionToCanonical: {'mg/L': 1},
    referenceRange: {low: 0, high: 3},
  },
];

/**
 * Normalize a name or unit for matching: lowercase, strip everything that is
 * not a Latin letter, a digit, or an Arabic character.
 */
export function normalizeToken(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');
}

/** Look up a panel entry by test id. `undefined` ⇒ not in the closed panel. */
export function getEntry(testId: string): OntologyEntry | undefined {
  return ONTOLOGY.find(e => e.testId === testId);
}

/** Panel closure: true only for the 6 canonical test ids. */
export function isPanelTest(testId: string): boolean {
  return getEntry(testId) !== undefined;
}

/**
 * Match an OCR line (or a free-form name string) to a panel entry.
 *
 * Returns the entry whose LONGEST normalized alias occurs as a substring of
 * the normalized input, or `null` when nothing matches (line is dropped).
 * Longest-match disambiguates lines containing several aliases, e.g.
 * "HDL Cholesterol 45 mg/dL" → hdl (alias 'HDL Cholesterol' beats 'Cholesterol').
 */
export function matchAlias(line: string): OntologyEntry | null {
  const normalized = normalizeToken(line);
  if (normalized.length === 0) {
    return null;
  }
  let best: OntologyEntry | null = null;
  let bestLen = 0;
  for (const entry of ONTOLOGY) {
    for (const alias of entry.aliases) {
      const a = normalizeToken(alias);
      if (a.length > 0 && normalized.includes(a) && a.length > bestLen) {
        best = entry;
        bestLen = a.length;
      }
    }
  }
  return best;
}

/** Map a raw unit token to the ontology's canonical unit spelling, if known. */
export function normalizeUnit(raw: string): string {
  const u = raw.trim().toLowerCase();
  switch (u) {
    case 'mg/dl':
      return 'mg/dL';
    case 'mmol/l':
      return 'mmol/L';
    case 'mg/l':
      return 'mg/L';
    case '%':
      return '%';
    default:
      return raw.trim();
  }
}

/**
 * Convert a raw value to the entry's canonical unit.
 * Returns `NaN` when the unit is not in the entry's conversion map
 * (unknown/unsupported unit ⇒ extraction must flag the value).
 */
export function convertToCanonical(
  entry: OntologyEntry,
  value: number,
  rawUnit: string,
): number {
  const factor = entry.conversionToCanonical[normalizeUnit(rawUnit)];
  if (factor === undefined) {
    return NaN;
  }
  return value * factor;
}

/**
 * Derive the 3 ratio features on-device from anthropometrics and the two
 * canonical-unit biomarkers that feed the Tyg index. Pure function.
 */
export function computeDerivedRatios(
  anthropometrics: Anthropometrics,
  fastingGlucoseMgdl: number,
  triglyceridesMgdl: number,
): DerivedRatios {
  const heightM = anthropometrics.height_cm / 100;
  return {
    bmi: anthropometrics.weight_kg / (heightM * heightM),
    whtr: anthropometrics.waist_cm / anthropometrics.height_cm,
    tyg_index: (fastingGlucoseMgdl * triglyceridesMgdl) / 200,
  };
}
