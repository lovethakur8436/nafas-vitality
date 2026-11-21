/**
 * Step 2 unit tests: closed panel, alias matching (EN + AR), unit
 * normalization, derived ratios, and constant sanity.
 *
 * @format
 */

import {
  ONTOLOGY,
  computeDerivedRatios,
  convertToCanonical,
  getEntry,
  isPanelTest,
  matchAlias,
  normalizeUnit,
} from './ontology';
import {
  DATA_TTL_DAYS,
  DATA_TTL_MS,
  LIFESTYLE_KEYS,
  METABOLIC_FEATURE_ORDER,
  OCR_CONFIDENCE_GATE,
  PERFORMANCE_BUDGETS_MS,
  RED_FLAG_KEYS,
  TIER_CUT_POINTS,
  VOUCHER_PROGRAM_CODE,
  VOUCHER_TTL_DAYS,
  VOUCHER_TTL_MS,
  VOUCHER_TOKEN_HEX_LENGTH,
} from './constants';

const ALLOWED_PANEL = [
  'hba1c',
  'fasting_glucose',
  'triglycerides',
  'hdl',
  'total_cholesterol',
  'hs_crp',
];

describe('panel closure', () => {
  it('contains exactly the 6 allowed biomarkers, in model-feature order', () => {
    expect(ONTOLOGY.map(e => e.testId)).toEqual(ALLOWED_PANEL);
    expect([...METABOLIC_FEATURE_ORDER]).toEqual(ALLOWED_PANEL);
  });

  it('rejects every out-of-scope test id', () => {
    const forbidden = [
      'bilirubin',
      'alt',
      'ast',
      'bun',
      'creatinine',
      'uric_acid',
      'ldl',
      'albumin',
      'total_protein',
      'random',
    ];
    for (const id of forbidden) {
      expect(isPanelTest(id)).toBe(false);
      expect(getEntry(id)).toBeUndefined();
    }
  });
});

describe('alias matching', () => {
  it('matches Latin aliases case-insensitively, incl. punctuation in the line', () => {
    expect(matchAlias('HbA1c 6.2 %')?.testId).toBe('hba1c');
    expect(matchAlias('A1C: 5.9 %')?.testId).toBe('hba1c');
    expect(matchAlias('Fasting Glucose (FBG) 95 mg/dL')?.testId).toBe(
      'fasting_glucose',
    );
    expect(matchAlias('TG 150 mg/dL')?.testId).toBe('triglycerides');
    expect(matchAlias('hs-CRP 0.4 mg/L')?.testId).toBe('hs_crp');
    expect(matchAlias('CRP (high sensitivity) 2.1 mg/L')?.testId).toBe(
      'hs_crp',
    );
  });

  it('matches Arabic-script aliases', () => {
    expect(matchAlias('السكر التراكمي 6.2 %')?.testId).toBe('hba1c');
    expect(matchAlias('الجلوكوز الصائم 110 mg/dL')?.testId).toBe(
      'fasting_glucose',
    );
    expect(matchAlias('الدهون الثلاثية 210 mg/dL')?.testId).toBe(
      'triglycerides',
    );
    expect(matchAlias('الكوليسترول الجيد 45 mg/dL')?.testId).toBe('hdl');
    expect(matchAlias('الكوليسترول الكلي 190 mg/dL')?.testId).toBe(
      'total_cholesterol',
    );
    expect(matchAlias('البروتين التفاعلي 1.2 mg/L')?.testId).toBe('hs_crp');
  });

  it('longest alias wins for lines containing several aliases', () => {
    // 'HDL Cholesterol' beats 'Cholesterol' (total_cholesterol).
    expect(matchAlias('HDL Cholesterol 45 mg/dL')?.testId).toBe('hdl');
    // 'Total Cholesterol' beats 'Cholesterol'.
    expect(matchAlias('Total Cholesterol 180 mg/dL')?.testId).toBe(
      'total_cholesterol',
    );
  });

  it('drops non-panel lines (closure)', () => {
    expect(matchAlias('ALT (SGPT) 40 U/L')).toBeNull();
    expect(matchAlias('AST (SGOT) 55 U/L')).toBeNull();
    expect(matchAlias('Total Bilirubin 1.2 mg/dL')).toBeNull();
    expect(matchAlias('BUN 18 mg/dL')).toBeNull();
    expect(matchAlias('Creatinine 0.9 mg/dL')).toBeNull();
    expect(matchAlias('Uric Acid 6.4 mg/dL')).toBeNull();
    expect(matchAlias('Random 42')).toBeNull();
    expect(matchAlias('')).toBeNull();
  });
});

describe('unit normalization', () => {
  const glucose = getEntry('fasting_glucose')!;
  const tg = getEntry('triglycerides')!;
  const hdl = getEntry('hdl')!;
  const tc = getEntry('total_cholesterol')!;
  const hba1c = getEntry('hba1c')!;
  const crp = getEntry('hs_crp')!;

  it('SI mmol/L → canonical mg/dL with the documented factors', () => {
    expect(convertToCanonical(glucose, 5.0, 'mmol/L')).toBeCloseTo(90.091, 3);
    expect(convertToCanonical(tg, 1.7, 'mmol/L')).toBeCloseTo(150.569, 3);
    expect(convertToCanonical(hdl, 1.16, 'mmol/L')).toBeCloseTo(44.857, 3);
    expect(convertToCanonical(tc, 5.17, 'mmol/L')).toBeCloseTo(199.924, 3);
  });

  it('canonical units pass through with factor 1', () => {
    expect(convertToCanonical(glucose, 95, 'mg/dL')).toBe(95);
    expect(convertToCanonical(hba1c, 6.2, '%')).toBe(6.2);
    expect(convertToCanonical(crp, 0.4, 'mg/L')).toBe(0.4);
  });

  it('accepts case-variant unit spellings', () => {
    expect(normalizeUnit('mg/dl')).toBe('mg/dL');
    expect(normalizeUnit('MMOL/L')).toBe('mmol/L');
    expect(normalizeUnit('  mg/L ')).toBe('mg/L');
    expect(convertToCanonical(glucose, 5.0, 'mmol/l')).toBeCloseTo(90.091, 3);
  });

  it('returns NaN for units outside the entry conversion map', () => {
    expect(Number.isNaN(convertToCanonical(hba1c, 38, 'mmol/L'))).toBe(true);
    expect(Number.isNaN(convertToCanonical(crp, 0.4, 'ug/L'))).toBe(true);
    expect(Number.isNaN(convertToCanonical(glucose, 5.0, 'g/dL'))).toBe(true);
  });
});

describe('derived ratios', () => {
  it('computes bmi, whtr, tyg_index from canonical inputs', () => {
    const r = computeDerivedRatios({height_cm: 170, weight_kg: 85, waist_cm: 100}, 110, 150);
    expect(r.bmi).toBeCloseTo(85 / (1.7 * 1.7), 6); // ≈ 29.41
    expect(r.whtr).toBeCloseTo(100 / 170, 6); // ≈ 0.5882
    expect(r.tyg_index).toBeCloseTo((110 * 150) / 200, 6); // 82.5
  });
});

describe('constants sanity', () => {
  it('TTLs: 30 days for data and vouchers, in ms', () => {
    expect(DATA_TTL_DAYS).toBe(30);
    expect(DATA_TTL_MS).toBe(30 * 86_400_000);
    expect(VOUCHER_TTL_DAYS).toBe(30);
    expect(VOUCHER_TTL_MS).toBe(30 * 86_400_000);
    expect(VOUCHER_TOKEN_HEX_LENGTH).toBe(64);
    expect(VOUCHER_PROGRAM_CODE.length).toBeGreaterThan(0);
  });

  it('confidence gate and tier cut points are ordered', () => {
    expect(OCR_CONFIDENCE_GATE).toBe(0.75);
    expect(TIER_CUT_POINTS.elevated).toBeGreaterThan(0);
    expect(TIER_CUT_POINTS.elevated).toBeLessThan(TIER_CUT_POINTS.high);
    expect(TIER_CUT_POINTS.high).toBeLessThanOrEqual(1);
  });

  it('performance budgets respect the V3 ordering', () => {
    const b = PERFORMANCE_BUDGETS_MS;
    expect(b.ocrPerPageMin).toBeLessThan(b.ocrPerPageMax);
    expect(b.inference).toBe(20);
    expect(b.shap).toBe(50);
    expect(b.inference + b.shap).toBeLessThan(b.endToEnd);
    expect(b.endToEnd).toBe(10_000);
  });

  it('feature-key tables match the types module shape', () => {
    expect(LIFESTYLE_KEYS).toHaveLength(4);
    expect(RED_FLAG_KEYS).toHaveLength(3);
  });
});
