/**
 * Step 3 unit tests: Gate 1A state machine — transition table, illegal
 * transition rejection, human-in-the-loop confirm gate, OCR draft purge,
 * inference gating, red-flag selector, voucher eligibility, resetAll.
 *
 * @format
 */

import {
  GATE1A_INITIAL_STATE,
  hasAllConfirmedValues,
  isInferenceEligible,
  selectRedFlags,
  useGate1AStore,
  type OcrExtraction,
  type QuestionnaireAnswers,
} from './store';
import {computeDerivedRatios, getEntry} from './ontology';
import {
  METABOLIC_FEATURE_ORDER,
  VOUCHER_PROGRAM_CODE,
  VOUCHER_TTL_MS,
} from './constants';
import type {Gate1AResult, MetabolicVector, Voucher} from './types';

const EXTRACT: OcrExtraction = {
  values: [
    {testId: 'hba1c', value: 5.9, unit: '%', confidence: 0.95},
    {testId: 'fasting_glucose', value: 105, unit: 'mg/dL', confidence: 0.9},
    {testId: 'triglycerides', value: 180, unit: 'mg/dL', confidence: 0.6},
    {testId: 'hdl', value: 42, unit: 'mg/dL', confidence: 0.88},
    {testId: 'total_cholesterol', value: 195, unit: 'mg/dL', confidence: 0.92},
    {testId: 'hs_crp', value: 1.1, unit: 'mg/L', confidence: 0.97},
    // Non-panel id — must be dropped by the closed panel.
    {testId: 'alt', value: 40, unit: 'U/L', confidence: 0.9},
    {testId: 'creatinine', value: 0.9, unit: 'mg/dL', confidence: 0.9},
  ],
  missing: [],
  fallback: false,
};

const ANSWERS: QuestionnaireAnswers = {
  age_years: 42,
  exercise_minutes_per_week: 90,
  alcohol_drinks_per_week: 2,
  sleep_hours_per_night: 6.5,
  waist_cm: 98,
  bmi_self_reported: 28.4,
  smoking: true,
  hypertension: false,
  family_history_t2d: true,
};

const RESULT_ELEVATED: Gate1AResult = {
  tier: 'ELEVATED',
  probability: 0.55,
  modelVersion: 'mock-0.0.1',
  shap: [
    {featureKey: 'fasting_glucose', contribution: 1.2},
    {featureKey: 'triglycerides', contribution: 0.8},
    {featureKey: 'hba1c', contribution: 0.5},
  ],
  computedAt: Date.now(),
};

const VOUCHER: Voucher = {
  token: 'ab'.repeat(32),
  programCode: VOUCHER_PROGRAM_CODE,
  mintedAt: Date.now(),
  expiresAt: Date.now() + VOUCHER_TTL_MS,
};

function makeVector(): MetabolicVector {
  const s = useGate1AStore.getState();
  const anthropometrics = {height_cm: 172, weight_kg: 84, waist_cm: 98};
  return {
    values: METABOLIC_FEATURE_ORDER.map(
      id => s.confirmedValues[id]!,
    ),
    anthropometrics,
    derived: computeDerivedRatios(anthropometrics, 105, 180),
    lifestyle: {
      age_years: 42,
      exercise_minutes_per_week: 90,
      alcohol_drinks_per_week: 2,
      sleep_hours_per_night: 6.5,
    },
    redFlags: {smoking: true, hypertension: false, family_history_t2d: true},
    assembledAt: Date.now(),
    contentHash: 'test-hash',
  };
}

/** Drive IDLE → CONFIRMING with the fixture extraction. */
function intoConfirming(): void {
  useGate1AStore.getState().loadPdf('file:///tmp/lab.pdf');
  useGate1AStore.getState().startOcr();
  useGate1AStore.getState().ocrComplete(EXTRACT);
}

/** Confirm all 6 panel values, optionally editing one. */
function confirmAll(edits?: Record<string, number>): void {
  for (const id of METABOLIC_FEATURE_ORDER) {
    const s = useGate1AStore.getState();
    const draft = s.draftValues![id];
    useGate1AStore
      .getState()
      .confirmValue(id, edits && edits[id] !== undefined ? edits[id] : draft.value);
  }
}

beforeEach(() => {
  useGate1AStore.getState().resetAll();
});

describe('happy path: full funnel', () => {
  it('walks IDLE → … → VOUCHER_ACCEPTED with the right field stamps', () => {
    expect(useGate1AStore.getState().state).toBe('IDLE');

    useGate1AStore.getState().loadPdf('file:///tmp/lab.pdf');
    expect(useGate1AStore.getState().state).toBe('PDF_LOADED');
    expect(useGate1AStore.getState().pdfUri).toBe('file:///tmp/lab.pdf');

    useGate1AStore.getState().startOcr();
    expect(useGate1AStore.getState().state).toBe('OCR_RUNNING');

    useGate1AStore.getState().ocrComplete(EXTRACT);
    let s = useGate1AStore.getState();
    expect(s.state).toBe('CONFIRMING');
    // Draft is structured only, panel-closed, and SEPARATE from confirmed.
    expect(Object.keys(s.draftValues!).sort()).toEqual(
      [...METABOLIC_FEATURE_ORDER].sort(),
    );
    expect(s.draftValues!['alt']).toBeUndefined();
    expect(Object.keys(s.confirmedValues)).toHaveLength(0);

    confirmAll();
    s = useGate1AStore.getState();
    expect(hasAllConfirmedValues(s.confirmedValues)).toBe(true);
    // TTL stamps present for later storage sweeps.
    for (const id of METABOLIC_FEATURE_ORDER) {
      expect(s.confirmedValues[id]!.confirmedAt).toBeGreaterThan(
        Date.now() - 60_000,
      );
    }

    useGate1AStore.getState().submitQuestionnaire(ANSWERS);
    s = useGate1AStore.getState();
    expect(s.state).toBe('QUESTIONNAIRE');
    // Transient OCR state purged immediately after confirmation.
    expect(s.pdfUri).toBeNull();
    expect(s.ocrPages).toBeNull();
    expect(s.draftValues).toBeNull();
    // Confirmed values survive the purge.
    expect(hasAllConfirmedValues(s.confirmedValues)).toBe(true);

    const vector = makeVector();
    useGate1AStore.getState().score(vector);
    expect(useGate1AStore.getState().state).toBe('SCORING');
    expect(useGate1AStore.getState().vector).toBe(vector);

    useGate1AStore.getState().scoreComplete(RESULT_ELEVATED);
    s = useGate1AStore.getState();
    expect(s.state).toBe('RESULT');
    expect(s.result?.tier).toBe('ELEVATED');
    expect(s.result?.shap).toHaveLength(3);

    useGate1AStore.getState().acceptKit(VOUCHER);
    s = useGate1AStore.getState();
    expect(s.state).toBe('VOUCHER_ACCEPTED');
    expect(s.voucher?.token).toBe(VOUCHER.token);
    expect(s.voucher?.programCode).toBe(VOUCHER_PROGRAM_CODE);
  });
});

describe('illegal transitions are rejected (no-op)', () => {
  it('rejects out-of-order actions from IDLE', () => {
    const st = useGate1AStore.getState;
    st().startOcr();
    expect(st().state).toBe('IDLE');
    st().ocrComplete(EXTRACT);
    expect(st().state).toBe('IDLE');
    expect(st().draftValues).toBeNull();
    st().confirmValue('hba1c', 6.0);
    expect(st().confirmedValues['hba1c']).toBeUndefined();
    st().submitQuestionnaire(ANSWERS);
    expect(st().state).toBe('IDLE');
    st().score(makeVector());
    expect(st().state).toBe('IDLE');
    st().scoreComplete(RESULT_ELEVATED);
    expect(st().result).toBeNull();
    st().acceptKit(VOUCHER);
    expect(st().voucher).toBeNull();
  });

  it('rejects score/scoreComplete/acceptKit from wrong states', () => {
    intoConfirming();
    const st = useGate1AStore.getState;
    st().score(makeVector());
    expect(st().state).toBe('CONFIRMING');
    st().scoreComplete(RESULT_ELEVATED);
    expect(st().state).toBe('CONFIRMING');
    expect(st().result).toBeNull();
    st().acceptKit(VOUCHER);
    expect(st().voucher).toBeNull();
  });

  it('rejects loadPdf mid-funnel (after confirm, the PDF is done)', () => {
    intoConfirming();
    useGate1AStore.getState().loadPdf('file:///tmp/other.pdf');
    expect(useGate1AStore.getState().state).toBe('CONFIRMING');
  });
});

describe('panel closure at the store boundary', () => {
  it('confirmValue ignores non-panel test ids', () => {
    intoConfirming();
    const st = useGate1AStore.getState;
    for (const id of ['alt', 'ast', 'bilirubin', 'bun', 'creatinine', 'uric_acid']) {
      st().confirmValue(id, 1);
      expect(st().confirmedValues[id]).toBeUndefined();
    }
  });
});

describe('human-in-the-loop confirm gate', () => {
  it('same value as draft ⇒ source ocr with draft confidence', () => {
    intoConfirming();
    useGate1AStore.getState().confirmValue('hba1c', 5.9);
    const v = useGate1AStore.getState().confirmedValues['hba1c']!;
    expect(v.source).toBe('ocr');
    expect(v.confidence).toBe(0.95);
    expect(v.unit).toBe(getEntry('hba1c')!.canonicalUnit);
  });

  it('edited value ⇒ source manual with confidence 1.0', () => {
    intoConfirming();
    useGate1AStore.getState().confirmValue('fasting_glucose', 110);
    const v = useGate1AStore.getState().confirmedValues['fasting_glucose']!;
    expect(v.source).toBe('manual');
    expect(v.confidence).toBe(1.0);
    expect(v.value).toBe(110);
  });

  it('MANUAL_ENTRY branch: even an unedited value is manual', () => {
    intoConfirming();
    useGate1AStore.getState().switchToManual();
    expect(useGate1AStore.getState().state).toBe('MANUAL_ENTRY');
    useGate1AStore.getState().confirmValue('hdl', 42);
    const v = useGate1AStore.getState().confirmedValues['hdl']!;
    expect(v.source).toBe('manual');
    expect(v.confidence).toBe(1.0);
    // Sub-branch can go back to CONFIRMING.
    useGate1AStore.getState().switchToManual();
    expect(useGate1AStore.getState().state).toBe('CONFIRMING');
  });
});

describe('inference gating', () => {
  it('submitQuestionnaire is blocked while a value is missing', () => {
    intoConfirming();
    // Confirm only 5 of the 6.
    confirmAll();
    // Rebuild state with hs_crp removed to simulate a missing confirm.
    const {hs_crp: _drop, ...five} = useGate1AStore.getState().confirmedValues;
    useGate1AStore.setState({confirmedValues: five});
    useGate1AStore.getState().submitQuestionnaire(ANSWERS);
    const s = useGate1AStore.getState();
    expect(s.state).toBe('CONFIRMING');
    expect(isInferenceEligible(s)).toBe(false);
    expect(hasAllConfirmedValues(s.confirmedValues)).toBe(false);
  });

  it('score is blocked in QUESTIONNAIRE when a value is missing', () => {
    intoConfirming();
    confirmAll();
    const {hs_crp: _drop, ...five} = useGate1AStore.getState().confirmedValues;
    useGate1AStore.setState({
      state: 'QUESTIONNAIRE',
      confirmedValues: five,
      questionnaire: ANSWERS,
    });
    useGate1AStore.getState().score(makeVector());
    expect(useGate1AStore.getState().state).toBe('QUESTIONNAIRE');
    expect(useGate1AStore.getState().vector).toBeNull();
  });

  it('isInferenceEligible is true exactly in the gated state', () => {
    intoConfirming();
    expect(isInferenceEligible(useGate1AStore.getState())).toBe(false);
    confirmAll();
    useGate1AStore.getState().submitQuestionnaire(ANSWERS);
    expect(isInferenceEligible(useGate1AStore.getState())).toBe(true);
  });
});

describe('red-flag selector', () => {
  it('all false before the questionnaire, mirrors it after', () => {
    expect(selectRedFlags(useGate1AStore.getState())).toEqual({
      smoking: false,
      hypertension: false,
      family_history_t2d: false,
    });
    intoConfirming();
    confirmAll();
    useGate1AStore.getState().submitQuestionnaire(ANSWERS);
    expect(selectRedFlags(useGate1AStore.getState())).toEqual({
      smoking: true,
      hypertension: false,
      family_history_t2d: true,
    });
  });
});

describe('voucher eligibility', () => {
  it('acceptKit is rejected on a LOW tier', () => {
    intoConfirming();
    confirmAll();
    useGate1AStore.getState().submitQuestionnaire(ANSWERS);
    useGate1AStore.getState().score(makeVector());
    useGate1AStore
      .getState()
      .scoreComplete({...RESULT_ELEVATED, tier: 'LOW', probability: 0.1});
    useGate1AStore.getState().acceptKit(VOUCHER);
    const s = useGate1AStore.getState();
    expect(s.state).toBe('RESULT');
    expect(s.voucher).toBeNull();
  });
});

describe('clearOcrDraft + resetAll', () => {
  it('clearOcrDraft wipes transient OCR state, keeps confirmed values', () => {
    intoConfirming();
    useGate1AStore.getState().confirmValue('hba1c', 5.9);
    useGate1AStore.getState().clearOcrDraft();
    const s = useGate1AStore.getState();
    expect(s.state).toBe('CONFIRMING');
    expect(s.pdfUri).toBeNull();
    expect(s.ocrPages).toBeNull();
    expect(s.draftValues).toBeNull();
    expect(s.confirmedValues['hba1c']).toBeDefined();
  });

  it('resetAll wipes every field after a full voucher flow', () => {
    intoConfirming();
    confirmAll();
    useGate1AStore.getState().submitQuestionnaire(ANSWERS);
    useGate1AStore.getState().score(makeVector());
    useGate1AStore.getState().scoreComplete(RESULT_ELEVATED);
    useGate1AStore.getState().acceptKit(VOUCHER);
    expect(useGate1AStore.getState().state).toBe('VOUCHER_ACCEPTED');

    useGate1AStore.getState().resetAll();
    expect(useGate1AStore.getState()).toEqual(
      expect.objectContaining({
        ...GATE1A_INITIAL_STATE,
        state: 'IDLE',
      }),
    );
    const s = useGate1AStore.getState();
    expect(s.voucher).toBeNull();
    expect(s.result).toBeNull();
    expect(s.vector).toBeNull();
    expect(Object.keys(s.confirmedValues)).toHaveLength(0);
  });

  it('deleteAll is an alias of resetAll', () => {
    intoConfirming();
    useGate1AStore.getState().deleteAll();
    expect(useGate1AStore.getState().state).toBe('IDLE');
    expect(useGate1AStore.getState().draftValues).toBeNull();
  });
});
