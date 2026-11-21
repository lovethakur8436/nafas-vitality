/**
 * Step 14 end-to-end integration test: the full Gate 1A flow.
 *
 * Drives the real screens in machine order — UploadScreen (lab scan / OCR)
 * → ConfirmScreen (human-in-the-loop value confirmation) →
 * QuestionnaireScreen (lifestyle + vector assembly) → ResultScreen (on-
 * device scoring, result, voucher/consent, wipe) — through their UI
 * (testID taps / text entry only, no direct store calls except the
 * final wipe in the reset test, which exercises the plan's `deleteAll`
 * alias).
 *
 * RN 0.88 / React 19.3 convention (see screens/ResultScreen.test.tsx):
 * `await act(...)` plus one `setTimeout(0)` tick before reading the tree.
 *
 * Covers:
 *   1. Happy path: pick → OCR → CONFIRMING (6 draft values, file purged,
 *      structured values only) → confirm all 6 (source stays `ocr`) →
 *      questionnaire submit (CONFIRMING → QUESTIONNAIRE → SCORING, vector
 *      in ontology order, transient OCR state purged) → RESULT via the
 *      on-device engine → kit accept → VOUCHER_ACCEPTED with a
 *      deterministic seeded 64-hex bearer voucher, program code, 30-day
 *      TTL, T2 consent scope on screen + persisted → "Delete all" ⇒
 *      total storage wipe ⇒ IDLE.
 *   2. Reset branch: mid-flow `deleteAll()` from CONFIRMING with partial
 *      confirmations ⇒ every field wiped to the IDLE initial state,
 *      nothing persisted, and the flow restarts from a fresh scan.
 *
 * @format
 */

import {act} from 'react';
import ReactTestRenderer from 'react-test-renderer';

import UploadScreen, {MockLabPdfPicker} from './screens/UploadScreen';
import ConfirmScreen from './screens/ConfirmScreen';
import QuestionnaireScreen from './screens/QuestionnaireScreen';
import ResultScreen from './screens/ResultScreen';
import {
  GATE1A_INITIAL_STATE,
  hasAllConfirmedValues,
  useGate1AStore,
} from './store';
import {
  DATA_TTL_MS,
  METABOLIC_FEATURE_ORDER,
  VOUCHER_PROGRAM_CODE,
  VOUCHER_TTL_MS,
} from './constants';
import {getEntry} from './ontology';
import {MOCK_FIXTURE_URIS, MockLabOCRService} from './ocr/MockLabOCRService';
import {
  MOCK_MODEL_VERSION,
  MockMetabolicModel,
} from './engine/MockMetabolicModel';
import {MockEncryptedStorage} from './storage';
import {createSeededRng, mintVoucher, type Csprng} from './voucher';

const SEED = 42;
const FIXTURE_URI = MOCK_FIXTURE_URIS.elevatedRiskMgdl;

const tick = (): Promise<void> => new Promise(resolve =>
  setTimeout(resolve, 0),
);

/** Flatten every text node of the rendered tree into one searchable string. */
function allText(c: ReactTestRenderer.ReactTestRenderer): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) {
      return;
    }
    if (typeof node === 'string') {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) {
        walk(n);
      }
      return;
    }
    const obj = node as {children?: unknown};
    if (obj.children !== undefined) {
      walk(obj.children);
    }
  };
  walk(c.toJSON());
  return parts.join('\n');
}

async function renderUpload(
  ocr: MockLabOCRService,
  picker: MockLabPdfPicker,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  const c = await act(async () =>
    ReactTestRenderer.create(<UploadScreen ocr={ocr} picker={picker} />),
  );
  await tick();
  return c;
}

async function renderConfirm(): Promise<
  ReactTestRenderer.ReactTestRenderer
> {
  const c = await act(async () => ReactTestRenderer.create(<ConfirmScreen />));
  await tick();
  return c;
}

async function renderQuestionnaire(): Promise<
  ReactTestRenderer.ReactTestRenderer
> {
  const c = await act(async () =>
    ReactTestRenderer.create(<QuestionnaireScreen />),
  );
  await tick();
  return c;
}

async function renderResult(
  engine: MockMetabolicModel,
  storage: MockEncryptedStorage,
  rng: Csprng,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  const c = await act(async () =>
    ReactTestRenderer.create(
      <ResultScreen engine={engine} storage={storage} rng={rng} />,
    ),
  );
  await tick();
  return c;
}

async function unmount(
  c: ReactTestRenderer.ReactTestRenderer,
): Promise<void> {
  await act(async () => {
    c.unmount();
  });
}

/** Tap the pick CTA and let pick → loadPdf → OCR → ocrComplete settle. */
async function pickPdf(
  c: ReactTestRenderer.ReactTestRenderer,
): Promise<void> {
  // Await the handler's promise INSIDE act: recognizePdf/purge resolve on
  // setTimeout(0) macrotasks, so act's microtask flush alone would close
  // before setPhase('done') runs — the final update would leak outside.
  let started: Promise<void> | undefined;
  await act(async () => {
    started = c.root
      .findByProps({testID: 'upload-pick'})
      .props.onPress() as unknown as Promise<void>;
    await started;
  });
  await tick();
}

/** Drive ConfirmScreen until `count` values are confirmed via the UI. */
async function confirmFirst(
  c: ReactTestRenderer.ReactTestRenderer,
  count: number,
): Promise<void> {
  for (const id of METABOLIC_FEATURE_ORDER.slice(0, count)) {
    await act(async () => {
      c.root.findByProps({testID: `confirm-ok-${id}`}).props.onPress();
    });
  }
  await tick();
}

describe('Gate 1A — Step 14 end-to-end integration', () => {
  let engine: MockMetabolicModel;
  let storage: MockEncryptedStorage;
  let rng: Csprng;

  beforeEach(async () => {
    useGate1AStore.setState(GATE1A_INITIAL_STATE);
    engine = new MockMetabolicModel();
    await engine.load();
    storage = new MockEncryptedStorage();
    rng = createSeededRng(SEED);
  });

  it('full flow: scan → confirm → questionnaire → scoring → voucher → delete-all', async () => {
    // ── 1. Lab scan: UploadScreen ──────────────────────────────────────
    const ocr = new MockLabOCRService({latencyMs: 0});
    const picker = new MockLabPdfPicker([FIXTURE_URI]);
    let c = await renderUpload(ocr, picker);
    expect(allText(c)).toContain('Select lab report'); // idle, not scanned

    await pickPdf(c);

    // OCR complete ⇒ CONFIRMING with the 6 panel drafts. V3: the store
    // holds ONLY structured values — the PDF file is purged right after
    // recognition, and no pages/images ever land in the store.
    let s = useGate1AStore.getState();
    expect(s.state).toBe('CONFIRMING');
    expect(Object.keys(s.draftValues ?? {}).sort()).toEqual(
      [...METABOLIC_FEATURE_ORDER].sort(),
    );
    expect(s.pdfUri).toBe(FIXTURE_URI); // URI handle only, never a buffer
    expect(s.ocrPages).toBeNull();
    expect(ocr.purgedUris).toContain(FIXTURE_URI);
    expect(allText(c)).toContain('Reading complete');
    await unmount(c);

    // ── 2. Confirmation: ConfirmScreen ─────────────────────────────────
    c = await renderConfirm();
    await confirmFirst(c, METABOLIC_FEATURE_ORDER.length);

    // Human-in-the-loop gate satisfied: all 6 confirmed, still CONFIRMING
    // (the questionnaire owns the next transition). Confirming each field
    // with its untouched OCR draft keeps source `ocr` + draft confidence.
    s = useGate1AStore.getState();
    expect(s.state).toBe('CONFIRMING');
    expect(hasAllConfirmedValues(s.confirmedValues)).toBe(true);
    for (const id of METABOLIC_FEATURE_ORDER) {
      const v = s.confirmedValues[id];
      expect(v.source).toBe('ocr');
      expect(v.confidence).toBeGreaterThan(0);
      expect(v.confidence).toBeLessThanOrEqual(1);
      expect(v.value).toBe(s.draftValues![id].value);
      expect(v.unit).toBe(getEntry(id)!.canonicalUnit);
      expect(v.confirmedAt).toBeGreaterThan(0);
    }
    // The "all values" gate opens only once all 6 are confirmed.
    expect(c.root.findByProps({testID: 'confirm-all'}).props.disabled).toBe(
      false,
    );
    await unmount(c);

    // ── 3. Questionnaire: QuestionnaireScreen ──────────────────────────
    c = await renderQuestionnaire();
    const submitDisabled = () =>
      c.root
        .findByProps({testID: 'questionnaire-submit'})
        .props.disabled;
    expect(submitDisabled()).toBe(true);

    const setField = async (testID: string, value: string): Promise<void> => {
      await act(async () => {
        (
          c.root.findByProps({testID}).props
            .onChangeText as (v: string) => void
        )(value);
      });
      await tick();
    };
    await setField('q-age', '58');
    await setField('q-height', '170');
    await setField('q-weight', '92');
    await setField('q-waist', '102');
    await setField('q-exercise', '45');
    await setField('q-alcohol', '4');
    await setField('q-sleep', '6');
    await act(async () => {
      c.root.findByProps({testID: 'q-smoking-no'}).props.onPress();
    });
    await act(async () => {
      c.root.findByProps({testID: 'q-hypertension-yes'}).props.onPress();
    });
    await act(async () => {
      c.root.findByProps({testID: 'q-family-no'}).props.onPress();
    });
    await tick();
    expect(submitDisabled()).toBe(false);

    await act(async () => {
      c.root
        .findByProps({testID: 'questionnaire-submit'})
        .props.onPress();
    });
    await tick();

    // Submit advances CONFIRMING → QUESTIONNAIRE → SCORING and assembles
    // the full vector in ontology order (canonical units), purging the
    // transient OCR state (parse + confirm ⇒ purge).
    s = useGate1AStore.getState();
    expect(s.state).toBe('SCORING');
    expect(s.questionnaire).not.toBeNull();
    expect(s.questionnaire!.hypertension).toBe(true);
    expect(s.pdfUri).toBeNull();
    expect(s.draftValues).toBeNull();
    const v = s.vector;
    expect(v).not.toBeNull();
    METABOLIC_FEATURE_ORDER.forEach((id, i) => {
      expect(v!.values[i].testId).toBe(id);
      expect(v!.values[i].unit).toBe(getEntry(id)!.canonicalUnit);
    });
    await unmount(c);

    // ── 4. Scoring + result: ResultScreen ──────────────────────────────
    c = await renderResult(engine, storage, rng);

    // The mount effect runs the on-device engine once ⇒ RESULT on the
    // same tick. The elevated-risk fixture lands above the LOW cut.
    s = useGate1AStore.getState();
    expect(s.state).toBe('RESULT');
    expect(s.result).not.toBeNull();
    expect(['ELEVATED', 'HIGH']).toContain(s.result!.tier);
    expect(s.result!.modelVersion).toBe(MOCK_MODEL_VERSION);
    expect(allText(c)).toContain(s.result!.tier);

    // The result is persisted on-device under the default 30-day TTL.
    const resultRec = await storage.load('gate1a-result');
    expect(resultRec).not.toBeNull();
    expect(resultRec!.ttlMs).toBe(DATA_TTL_MS);

    // ELEVATED/HIGH ⇒ the kit offer CTA is on screen.
    c.root.findByProps({testID: 'result-accept'});

    // ── 5. Kit accept ⇒ voucher + T2 consent ───────────────────────────
    await act(async () => {
      c.root.findByProps({testID: 'result-accept'}).props.onPress();
    });
    await tick();

    s = useGate1AStore.getState();
    expect(s.state).toBe('VOUCHER_ACCEPTED');
    const voucher = s.voucher;
    expect(voucher).not.toBeNull();
    expect(voucher!.token).toMatch(/^[0-9a-f]{64}$/);
    // Seeded CSPRNG ⇒ the bearer token is deterministic for this tier.
    expect(voucher!.token).toBe(
      mintVoucher(createSeededRng(SEED), s.result!.tier).token,
    );
    expect(voucher!.programCode).toBe(VOUCHER_PROGRAM_CODE);
    expect(voucher!.expiresAt - voucher!.mintedAt).toBe(VOUCHER_TTL_MS);

    // Voucher card replaces the CTA row; program code, token and the T2
    // consent scope are displayed.
    expect(c.root.findAllByProps({testID: 'result-accept'})).toHaveLength(0);
    const text = allText(c);
    expect(text).toContain(VOUCHER_PROGRAM_CODE);
    expect(text).toContain(voucher!.token);
    expect(text).toContain('hormone_panel');

    // The bearer voucher is persisted with the 30-day TTL stamp.
    const voucherRec = await storage.load('gate1a-voucher');
    expect(voucherRec).not.toBeNull();
    expect(voucherRec!.ttlMs).toBe(VOUCHER_TTL_MS);
    expect(
      (voucherRec!.data as {voucher: {token: string}}).voucher.token,
    ).toBe(voucher!.token);

    // ── 6. "Delete all" ⇒ total wipe ⇒ IDLE ────────────────────────────
    await act(async () => {
      c.root.findByProps({testID: 'result-delete-all'}).props.onPress();
    });
    await tick();

    expect(storage.size).toBe(0);
    s = useGate1AStore.getState();
    expect(s).toMatchObject(GATE1A_INITIAL_STATE);
    expect(allText(c)).toContain('No result yet');
    await unmount(c);
  });

  it('reset branch: deleteAll mid-flow wipes to IDLE and the flow restarts', async () => {
    // Scan to CONFIRMING through the real UI.
    const ocr = new MockLabOCRService({latencyMs: 0});
    const picker = new MockLabPdfPicker([FIXTURE_URI]);
    let c = await renderUpload(ocr, picker);
    await pickPdf(c);
    expect(useGate1AStore.getState().state).toBe('CONFIRMING');
    await unmount(c);

    // Partial confirmation (2 of 6) via ConfirmScreen.
    c = await renderConfirm();
    await confirmFirst(c, 2);
    const s = useGate1AStore.getState();
    expect(s.state).toBe('CONFIRMING');
    expect(Object.keys(s.confirmedValues)).toHaveLength(2);
    expect(hasAllConfirmedValues(s.confirmedValues)).toBe(false);
    await unmount(c);

    // Wipe (plan alias `deleteAll`) ⇒ every field back to IDLE initial.
    await act(async () => {
      useGate1AStore.getState().deleteAll();
    });
    await tick();

    const after = useGate1AStore.getState();
    expect(after).toMatchObject(GATE1A_INITIAL_STATE);
    expect(after.state).toBe('IDLE');
    expect(storage.size).toBe(0); // nothing was persisted mid-flow

    // The flow restarts from a fresh scan on the same (wiped) machine.
    const ocr2 = new MockLabOCRService({latencyMs: 0});
    const picker2 = new MockLabPdfPicker([FIXTURE_URI]);
    c = await renderUpload(ocr2, picker2);
    expect(allText(c)).toContain('Select lab report');
    await pickPdf(c);
    expect(useGate1AStore.getState().state).toBe('CONFIRMING');
    await unmount(c);
  });
});
