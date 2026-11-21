/**
 * Step 10 render tests: UploadScreen (pick → OCR progress → confirm handoff).
 *
 * RN 0.88 / React 19.3 convention (see __tests__/App.test.tsx): the
 * scheduler commits the initial render on a macrotask — `await act(...)`
 * plus one `setTimeout(0)` tick before reading the tree. Async button
 * handlers are awaited INSIDE `act` so no state update leaks outside it.
 *
 * Covers: the full pick → OCR → CONFIRMING hand-off with purge (V3
 * constraint 3), visible OCR progress while the engine runs, a cancelled
 * picker leaving the machine IDLE, and an OCR failure surfacing the error
 * and resetting the machine.
 *
 * @format
 */

import {act} from 'react';
import ReactTestRenderer from 'react-test-renderer';

import UploadScreen, {MockLabPdfPicker} from './UploadScreen';
import {GATE1A_INITIAL_STATE, useGate1AStore} from '../store';
import {
  MOCK_FIXTURE_URIS,
  MockLabOCRService,
} from '../ocr/MockLabOCRService';
import {OcrError} from '../ocr/LabOCR';
import type {LabOCR, OcrResult} from '../ocr/LabOCR';
import {METABOLIC_FEATURE_ORDER} from '../constants';

const tick = (): Promise<void> => new Promise(resolve =>
  setTimeout(resolve, 0),
);

const fastOcr = (): MockLabOCRService => new MockLabOCRService({latencyMs: 0});

beforeEach(() => {
  useGate1AStore.setState(GATE1A_INITIAL_STATE);
});

describe('UploadScreen — happy path (pick → OCR → CONFIRMING + purge)', () => {
  it('picks a PDF, runs OCR, hands the extraction to the store, purges the file', async () => {
    const ocr = fastOcr();
    const uri = MOCK_FIXTURE_URIS.elevatedRiskMgdl;
    const picker = new MockLabPdfPicker([uri]);

    const c = await act(async () =>
      ReactTestRenderer.create(<UploadScreen ocr={ocr} picker={picker} />),
    );
    await tick();
    expect(JSON.stringify(c.toJSON())).toContain('Select lab report');

    let started: Promise<void> | undefined;
    await act(async () => {
      started = c.root
        .findByProps({testID: 'upload-pick'})
        .props.onPress() as unknown as Promise<void>;
      await started;
    });
    await tick();

    // The store advanced to CONFIRMING with all 6 closed-panel values.
    const s = useGate1AStore.getState();
    expect(s.state).toBe('CONFIRMING');
    expect(Object.keys(s.draftValues ?? {}).sort()).toEqual(
      [...METABOLIC_FEATURE_ORDER].sort(),
    );
    // V3 constraint 3: the raw file is purged immediately after parse.
    expect(ocr.purgedUris).toContain(uri);
    // The screen hands off to the confirm step.
    expect(JSON.stringify(c.toJSON())).toContain('Reading complete');
    c.unmount();
  });
});

describe('UploadScreen — OCR progress', () => {
  it('shows the progress state (1-3 s budget) while the engine runs, then completes', async () => {
    const real = fastOcr();
    const uri = MOCK_FIXTURE_URIS.ifhasBilingualMmolL;
    let release: ((r: OcrResult) => void) | null = null;
    const ocr: LabOCR = {
      engineId: 'slow-mock',
      recognizePdf: () =>
        new Promise<OcrResult>(resolve => {
          release = resolve;
        }),
      purge: u => real.purge(u),
    };
    const picker = new MockLabPdfPicker([uri]);

    const c = await act(async () =>
      ReactTestRenderer.create(<UploadScreen ocr={ocr} picker={picker} />),
    );
    await tick();

    let started: Promise<void> | undefined;
    await act(async () => {
      started = c.root
        .findByProps({testID: 'upload-pick'})
        .props.onPress() as unknown as Promise<void>;
    });
    await tick();

    // Progress is visible mid-run and the machine sits in OCR_RUNNING.
    let tree = JSON.stringify(c.toJSON());
    expect(tree).toContain('Reading your report');
    expect(tree).toContain('1-3 seconds');
    expect(useGate1AStore.getState().state).toBe('OCR_RUNNING');

    // Release the engine and let the screen finish.
    const result = await real.recognizePdf(uri);
    await act(async () => {
      release!(result);
      await started;
    });
    await tick();

    expect(useGate1AStore.getState().state).toBe('CONFIRMING');
    expect(real.purgedUris).toContain(uri);
    tree = JSON.stringify(c.toJSON());
    expect(tree).toContain('Reading complete');
    c.unmount();
  });
});

describe('UploadScreen — picker cancelled', () => {
  it('a null pick leaves the store IDLE and never calls OCR', async () => {
    let ocrCalls = 0;
    const real = fastOcr();
    const ocr: LabOCR = {
      engineId: 'mock',
      recognizePdf: u => {
        ocrCalls += 1;
        return real.recognizePdf(u);
      },
      purge: u => real.purge(u),
    };
    const picker = new MockLabPdfPicker([null]);

    const c = await act(async () =>
      ReactTestRenderer.create(<UploadScreen ocr={ocr} picker={picker} />),
    );
    await tick();

    let started: Promise<void> | undefined;
    await act(async () => {
      started = c.root
        .findByProps({testID: 'upload-pick'})
        .props.onPress() as unknown as Promise<void>;
      await started;
    });
    await tick();

    expect(useGate1AStore.getState().state).toBe('IDLE');
    expect(ocrCalls).toBe(0);
    expect(picker.picked).toEqual([null]);
    // Still on the idle view.
    expect(JSON.stringify(c.toJSON())).toContain('Select lab report');
    c.unmount();
  });
});

describe('UploadScreen — OCR failure', () => {
  it('surfaces the OcrError code and resets the machine to IDLE', async () => {
    const uri = MOCK_FIXTURE_URIS.unreadablePdf;
    const real = fastOcr();
    const ocr: LabOCR = {
      engineId: 'mock',
      recognizePdf: () => Promise.reject(new OcrError('unreadable', uri)),
      purge: u => real.purge(u),
    };
    const picker = new MockLabPdfPicker([uri]);

    const c = await act(async () =>
      ReactTestRenderer.create(<UploadScreen ocr={ocr} picker={picker} />),
    );
    await tick();

    let started: Promise<void> | undefined;
    await act(async () => {
      started = c.root
        .findByProps({testID: 'upload-pick'})
        .props.onPress() as unknown as Promise<void>;
      await started;
    });
    await tick();

    const tree = JSON.stringify(c.toJSON());
    expect(tree).toContain('unreadable');
    expect(tree).toContain('Try again');
    // The machine is back at IDLE so a re-pick works.
    expect(useGate1AStore.getState().state).toBe('IDLE');
    expect(useGate1AStore.getState().pdfUri).toBeNull();
    c.unmount();
  });
});
