/**
 * Step 11 render tests: ConfirmScreen (the human-in-the-loop gate).
 *
 * RN 0.88 / React 19.3 convention (see __tests__/App.test.tsx and
 * UploadScreen.test.tsx): `await act(...)` plus one `setTimeout(0)` tick
 * before reading the tree. Button handlers here are synchronous store
 * actions, so they are invoked inside `act` (no promise to await).
 *
 * Covers: editing a field away from its OCR draft stamps it manual
 * (source 'manual', confidence 1.0); "Confirm all values" stays disabled
 * until all six core values are confirmed; a low-confidence extraction that
 * forces a fallback renders the manual-entry form (manual title, no
 * confidence badges) and enters MANUAL_ENTRY on mount.
 *
 * @format
 */

import {act} from 'react';
import ReactTestRenderer from 'react-test-renderer';

import ConfirmScreen from './ConfirmScreen';
import {
  GATE1A_INITIAL_STATE,
  useGate1AStore,
  type OcrExtraction,
} from '../store';
import {METABOLIC_FEATURE_ORDER} from '../constants';

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

const NOISY: OcrExtraction = {
  values: [
    {testId: 'hba1c', value: 5.9, unit: '%', confidence: 0.3},
    {testId: 'fasting_glucose', value: 105, unit: 'mg/dL', confidence: 0.2},
    {testId: 'triglycerides', value: 180, unit: 'mg/dL', confidence: 0.25},
    {testId: 'hdl', value: 42, unit: 'mg/dL', confidence: 0.3},
    {testId: 'total_cholesterol', value: 195, unit: 'mg/dL', confidence: 0.2},
    {testId: 'hs_crp', value: 1.1, unit: 'mg/L', confidence: 0.35},
  ],
  missing: [],
  fallback: true,
};

function intoConfirming(extraction: OcrExtraction): void {
  useGate1AStore.getState().loadPdf('file:///tmp/lab.pdf');
  useGate1AStore.getState().startOcr();
  useGate1AStore.getState().ocrComplete(extraction);
}

beforeEach(() => {
  useGate1AStore.setState(GATE1A_INITIAL_STATE);
});

describe('ConfirmScreen — edit overrides OCR source', () => {
  it('confirming an edited field stamps it manual (source manual, confidence 1.0)', async () => {
    intoConfirming(EXTRACT);
    const c = await act(async () => ReactTestRenderer.create(<ConfirmScreen />));
    await tick();

    // The hba1c field is seeded with its OCR draft (5.9).
    const field = c.root.findByProps({testID: 'confirm-field-hba1c'});
    expect(field.props.value).toBe('5.9');

    // Edit it away from the draft.
    await act(async () => {
      (field.props.onChangeText as (v: string) => void)('6.2');
    });
    await tick();
    // Confirm the edited value.
    await act(async () => {
      c.root.findByProps({testID: 'confirm-ok-hba1c'}).props.onPress();
    });
    await tick();

    const lv = useGate1AStore.getState().confirmedValues.hba1c;
    expect(lv).toBeDefined();
    expect(lv.value).toBe(6.2);
    expect(lv.source).toBe('manual');
    expect(lv.confidence).toBe(1.0);
    c.unmount();
  });
});

describe('ConfirmScreen — all-values gate', () => {
  it('"Confirm all values" stays disabled until all 6 core values are confirmed', async () => {
    intoConfirming(EXTRACT);
    const c = await act(async () => ReactTestRenderer.create(<ConfirmScreen />));
    await tick();

    const allBtnDisabled = () =>
      c.root.findByProps({testID: 'confirm-all'}).props.disabled;
    expect(allBtnDisabled()).toBe(true); // 0 confirmed

    // Confirm the first five (each seeded with its OCR draft value).
    const ids = [...METABOLIC_FEATURE_ORDER];
    for (const id of ids.slice(0, 5)) {
      await act(async () => {
        c.root.findByProps({testID: `confirm-ok-${id}`}).props.onPress();
      });
      await tick();
    }
    expect(allBtnDisabled()).toBe(true); // 5 of 6

    // Confirm the last one → the gate opens.
    await act(async () => {
      c.root.findByProps({testID: `confirm-ok-${ids[5]}`}).props.onPress();
    });
    await tick();
    expect(allBtnDisabled()).toBe(false);
    c.unmount();
  });
});

describe('ConfirmScreen — manual-entry fallback', () => {
  it('renders the manual form (no confidence badges) and enters MANUAL_ENTRY', async () => {
    intoConfirming(NOISY);
    expect(useGate1AStore.getState().manualFallback).toBe(true);

    const c = await act(async () => ReactTestRenderer.create(<ConfirmScreen />));
    await tick();
    await tick(); // settle the mount-effect switchToManual re-render

    // The screen entered MANUAL_ENTRY and shows the manual title.
    expect(useGate1AStore.getState().manualEntry).toBe(true);
    const tree = JSON.stringify(c.toJSON());
    expect(tree).toContain('Enter your values');
    // No confidence badges in manual mode.
    expect(
      c.root.findAllByProps({testID: 'confirm-badge-hba1c'}),
    ).toHaveLength(0);
    c.unmount();
  });
});
