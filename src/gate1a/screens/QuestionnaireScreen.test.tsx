/**
 * Step 12 render tests: QuestionnaireScreen (5-min lifestyle form).
 *
 * RN 0.88 / React 19.3 convention (see UploadScreen.test.tsx): `await
 * act(...)` plus one `setTimeout(0)` tick before reading the tree. The
 * submit handler is a synchronous store action, invoked inside `act`.
 *
 * Covers: submit stays disabled until every field is answered; on submit the
 * screen records the answers and assembles the full MetabolicVector in
 * ontology order (values[i].testId === METABOLIC_FEATURE_ORDER[i], each in
 * the canonical unit), then scores it (CONFIRMING → QUESTIONNAIRE → SCORING).
 *
 * @format
 */

import {act} from 'react';
import ReactTestRenderer from 'react-test-renderer';

import QuestionnaireScreen from './QuestionnaireScreen';
import {
  GATE1A_INITIAL_STATE,
  useGate1AStore,
  type OcrExtraction,
} from '../store';
import {METABOLIC_FEATURE_ORDER} from '../constants';
import {getEntry} from '../ontology';

const tick = (): Promise<void> => new Promise(resolve =>
  setTimeout(resolve, 0),
);

const EXTRACT: OcrExtraction = {
  values: [
    {testId: 'hba1c', value: 5.9, unit: '%', confidence: 0.95},
    {testId: 'fasting_glucose', value: 105, unit: 'mg/dL', confidence: 0.9},
    {testId: 'triglycerides', value: 180, unit: 'mg/dL', confidence: 0.6},
    {testId: 'hdl', value: 42, unit: 'mg/dL', confidence: 0.88},
    {testId: 'total_cholesterol', value: 195, unit: 'mg/dL', confidence: 0.92},
    {testId: 'hs_crp', value: 1.1, unit: 'mg/L', confidence: 0.97},
  ],
  missing: [],
  fallback: false,
};

function intoConfirming(): void {
  useGate1AStore.getState().loadPdf('file:///tmp/lab.pdf');
  useGate1AStore.getState().startOcr();
  useGate1AStore.getState().ocrComplete(EXTRACT);
}

/** Confirm all six panel values with their OCR draft values (→ still CONFIRMING). */
function confirmAll(): void {
  for (const id of METABOLIC_FEATURE_ORDER) {
    const draft = useGate1AStore.getState().draftValues![id];
    useGate1AStore.getState().confirmValue(id, draft.value);
  }
}

beforeEach(() => {
  useGate1AStore.setState(GATE1A_INITIAL_STATE);
});

describe('QuestionnaireScreen — vector assembly + scoring', () => {
  it('assembles the vector in ontology order and scores it (→ SCORING)', async () => {
    intoConfirming();
    confirmAll();
    expect(useGate1AStore.getState().state).toBe('CONFIRMING');

    const c = await act(
      async () => ReactTestRenderer.create(<QuestionnaireScreen />),
    );
    await tick();

    // Submit is disabled until every field is answered.
    const submitDisabled = () =>
      c.root.findByProps({testID: 'questionnaire-submit'}).props.disabled;
    expect(submitDisabled()).toBe(true);

    const setField = async (testID: string, value: string) => {
      await act(async () => {
        (
          c.root.findByProps({testID}).props
            .onChangeText as (v: string) => void
        )(value);
      });
      await tick();
    };
    await setField('q-age', '42');
    await setField('q-height', '172');
    await setField('q-weight', '84');
    await setField('q-waist', '98');
    await setField('q-exercise', '90');
    await setField('q-alcohol', '2');
    await setField('q-sleep', '6.5');
    await act(async () => {
      c.root.findByProps({testID: 'q-smoking-yes'}).props.onPress();
    });
    await act(async () => {
      c.root.findByProps({testID: 'q-hypertension-no'}).props.onPress();
    });
    await act(async () => {
      c.root.findByProps({testID: 'q-family-yes'}).props.onPress();
    });
    await tick();

    // Every field answered → submit enables.
    expect(submitDisabled()).toBe(false);

    await act(async () => {
      c.root.findByProps({testID: 'questionnaire-submit'}).props.onPress();
    });
    await tick();

    // The machine advanced to SCORING with the assembled vector stored.
    const s = useGate1AStore.getState();
    expect(s.state).toBe('SCORING');
    expect(s.questionnaire).not.toBeNull();
    const v = s.vector;
    expect(v).not.toBeNull();

    // Vector assembly order matches the ontology contract: values[i].testId
    // === METABOLIC_FEATURE_ORDER[i], each value in its canonical unit.
    METABOLIC_FEATURE_ORDER.forEach((id, i) => {
      expect(v!.values[i].testId).toBe(id);
      expect(v!.values[i].unit).toBe(getEntry(id)!.canonicalUnit);
    });

    // Anthropometrics + derived ratios are finite.
    expect(v!.anthropometrics.height_cm).toBe(172);
    expect(v!.anthropometrics.weight_kg).toBe(84);
    expect(v!.anthropometrics.waist_cm).toBe(98);
    expect(Number.isFinite(v!.derived.bmi)).toBe(true);
    expect(Number.isFinite(v!.derived.whtr)).toBe(true);
    expect(Number.isFinite(v!.derived.tyg_index)).toBe(true);
    c.unmount();
  });
});
