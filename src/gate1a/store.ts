/**
 * Gate 1A — Zustand store: the state machine (Step 3).
 *
 * States: IDLE → PDF_LOADED → OCR_RUNNING → CONFIRMING → QUESTIONNAIRE
 *         → SCORING → RESULT → VOUCHER_ACCEPTED, with a MANUAL_ENTRY
 *         sub-branch off CONFIRMING. Illegal transitions are rejected
 *         (no-op), so the screens cannot force the machine out of order.
 *
 * V3 invariants enforced here:
 *  1. Human-in-the-loop OCR gate — the unconfirmed OCR draft
 *     (`draftValues`) is kept separate from user-confirmed values
 *     (`confirmedValues`); nothing is inference-eligible until every
 *     panel value has an explicit `confirmValue` action.
 *  2. No retained lab images — the store holds ONLY structured values
 *     (never PDF/image buffers). `clearOcrDraft()` (and the
 *     QUESTIONNAIRE transition) wipe the transient OCR state right after
 *     confirmation.
 *  3. Safety & lifecycle — `selectRedFlags` exposes the 3 deterministic
 *     red-flag booleans; the inference result + SHAP factors and the
 *     local bearer voucher (ELEVATED/HIGH only) are stored on-device;
 *     `resetAll()` (alias `deleteAll()`) wipes every field.
 *  4. Zustand 5, strict types, zero network calls.
 *
 * @format
 */

import {create} from 'zustand';

import type {
  Gate1AResult,
  Gate1AStateName,
  LabValue,
  MetabolicVector,
  OcrPage,
  RedFlags,
  Voucher,
} from './types';
import {getEntry, isPanelTest} from './ontology';
import {METABOLIC_FEATURE_ORDER} from './constants';

/** One structured, unconfirmed OCR-extracted value (never an image). */
export interface OcrExtractionValue {
  readonly testId: string;
  /** Value in the ontology canonical unit for this test. */
  readonly value: number;
  readonly unit: string;
  /** OCR confidence in [0,1]. */
  readonly confidence: number;
}

/** Structured extraction handed in by the OCR layer (Step 4/5). */
export interface OcrExtraction {
  readonly values: readonly OcrExtractionValue[];
  /** Panel test ids missing from the report. */
  readonly missing: readonly string[];
  /** True when the screen should fall back to the manual-entry form. */
  readonly fallback: boolean;
}

/** Lifestyle-questionnaire answers (Step 12 collects them). */
export interface QuestionnaireAnswers {
  readonly age_years: number;
  readonly exercise_minutes_per_week: number;
  readonly alcohol_drinks_per_week: number;
  readonly sleep_hours_per_night: number;
  readonly waist_cm: number;
  readonly bmi_self_reported: number;
  readonly smoking: boolean;
  readonly hypertension: boolean;
  readonly family_history_t2d: boolean;
}

export interface Gate1AStoreState {
  /** Current state-machine state. */
  readonly state: Gate1AStateName;
  /** URI handle of the picked lab PDF — a string, never a buffer. */
  readonly pdfUri: string | null;
  /** Transient OCR pages (structured text lines); purged after confirm. */
  readonly ocrPages: readonly OcrPage[] | null;
  /**
   * Unconfirmed OCR draft, keyed by panel test id. Kept SEPARATE from
   * `confirmedValues` (human-in-the-loop gate). Non-panel ids never land
   * here (closed panel).
   */
  readonly draftValues: Readonly<Record<string, OcrExtractionValue>> | null;
  /** Extraction flagged the whole screen for manual entry. */
  readonly manualFallback: boolean;
  /** True while the MANUAL_ENTRY sub-branch is active. */
  readonly manualEntry: boolean;
  /**
   * User-confirmed values, keyed by panel test id, with `confirmedAt`
   * TTL stamps. Inference is impossible until all 6 are present.
   */
  readonly confirmedValues: Readonly<Record<string, LabValue>>;
  /** Submitted questionnaire answers (null until QUESTIONNAIRE). */
  readonly questionnaire: QuestionnaireAnswers | null;
  /** Feature vector handed to the engine while SCORING / kept for audit. */
  readonly vector: MetabolicVector | null;
  /** Inference result incl. top-3 SHAP factors (null until RESULT). */
  readonly result: Gate1AResult | null;
  /** Local bearer voucher (null until ELEVATED/HIGH kit accepted). */
  readonly voucher: Voucher | null;
}

export interface Gate1AStoreActions {
  /** IDLE | PDF_LOADED → PDF_LOADED. Rejects from any other state. */
  loadPdf(uri: string): void;
  /** PDF_LOADED → OCR_RUNNING. */
  startOcr(): void;
  /** OCR_RUNNING → CONFIRMING. Stores the structured draft; drops non-panel ids. */
  ocrComplete(extraction: OcrExtraction): void;
  /**
   * CONFIRMING | MANUAL_ENTRY. Records a user-confirmed value.
   * Editing away from the draft value (or any value in manual mode)
   * stamps `source:'manual'`, confidence 1.0. Non-panel ids are ignored.
   */
  confirmValue(testId: string, value: number): void;
  /** CONFIRMING ⇄ MANUAL_ENTRY. */
  switchToManual(): void;
  /**
   * CONFIRMING | MANUAL_ENTRY → QUESTIONNAIRE. Requires all 6 confirmed
   * values; purges the transient OCR draft (V3: parse + confirm ⇒ purge).
   */
  submitQuestionnaire(answers: QuestionnaireAnswers): void;
  /** QUESTIONNAIRE → SCORING. Requires all 6 confirmed values. */
  score(vector: MetabolicVector): void;
  /** SCORING → RESULT. Stores the inference result + SHAP factors. */
  scoreComplete(result: Gate1AResult): void;
  /** RESULT (ELEVATED | HIGH only) → VOUCHER_ACCEPTED. Stores the voucher. */
  acceptKit(voucher: Voucher): void;
  /** Wipes pdfUri/ocrPages/draftValues immediately (state unchanged). */
  clearOcrDraft(): void;
  /** Always: wipes every field back to the IDLE initial state. */
  resetAll(): void;
  /** Alias of resetAll (plan name). */
  deleteAll(): void;
}

export type Gate1AStore = Gate1AStoreState & Gate1AStoreActions;

export const GATE1A_INITIAL_STATE: Gate1AStoreState = {
  state: 'IDLE',
  pdfUri: null,
  ocrPages: null,
  draftValues: null,
  manualFallback: false,
  manualEntry: false,
  confirmedValues: {},
  questionnaire: null,
  vector: null,
  result: null,
  voucher: null,
};

/** True when all 6 closed-panel values carry a user confirmation. */
export function hasAllConfirmedValues(
  confirmedValues: Readonly<Record<string, LabValue>>,
): boolean {
  return METABOLIC_FEATURE_ORDER.every(id => confirmedValues[id] !== undefined);
}

/**
 * Inference eligibility: the machine sits in QUESTIONNAIRE and every panel
 * value is confirmed. The only state from which `score()` will act.
 */
export function isInferenceEligible(s: Gate1AStoreState): boolean {
  return s.state === 'QUESTIONNAIRE' && hasAllConfirmedValues(s.confirmedValues);
}

/**
 * The 3 deterministic red-flag booleans: read from the submitted
 * questionnaire, all-false before it is submitted.
 */
export function selectRedFlags(s: Gate1AStoreState): RedFlags {
  const q = s.questionnaire;
  return {
    smoking: q?.smoking ?? false,
    hypertension: q?.hypertension ?? false,
    family_history_t2d: q?.family_history_t2d ?? false,
  };
}

export const useGate1AStore = create<Gate1AStore>()((set, get) => ({
  ...GATE1A_INITIAL_STATE,

  loadPdf: uri => {
    const s = get();
    if (s.state !== 'IDLE' && s.state !== 'PDF_LOADED') {
      return;
    }
    set({state: 'PDF_LOADED', pdfUri: uri, ocrPages: null, draftValues: null});
  },

  startOcr: () => {
    if (get().state !== 'PDF_LOADED') {
      return;
    }
    set({state: 'OCR_RUNNING'});
  },

  ocrComplete: extraction => {
    const s = get();
    if (s.state !== 'OCR_RUNNING') {
      return;
    }
    const draft: Record<string, OcrExtractionValue> = {};
    for (const v of extraction.values) {
      // Panel closure: non-panel ids are dropped at the boundary.
      if (isPanelTest(v.testId)) {
        draft[v.testId] = v;
      }
    }
    set({
      state: 'CONFIRMING',
      draftValues: draft,
      manualFallback: extraction.fallback,
    });
  },

  confirmValue: (testId, value) => {
    const s = get();
    if (s.state !== 'CONFIRMING' && s.state !== 'MANUAL_ENTRY') {
      return;
    }
    if (!isPanelTest(testId) || !Number.isFinite(value)) {
      return;
    }
    const entry = getEntry(testId)!;
    const draft = s.draftValues?.[testId];
    const isManual =
      s.manualEntry || draft === undefined || value !== draft.value;
    const labValue: LabValue = {
      testId,
      value,
      unit: entry.canonicalUnit,
      confidence: isManual ? 1.0 : draft!.confidence,
      source: isManual ? 'manual' : 'ocr',
      confirmedAt: Date.now(),
    };
    set({confirmedValues: {...s.confirmedValues, [testId]: labValue}});
  },

  switchToManual: () => {
    const s = get();
    if (s.state === 'CONFIRMING') {
      set({state: 'MANUAL_ENTRY', manualEntry: true});
    } else if (s.state === 'MANUAL_ENTRY') {
      set({state: 'CONFIRMING', manualEntry: false});
    }
  },

  submitQuestionnaire: answers => {
    const s = get();
    if (s.state !== 'CONFIRMING' && s.state !== 'MANUAL_ENTRY') {
      return;
    }
    // No inference possible unless all confirmed values are present.
    if (!hasAllConfirmedValues(s.confirmedValues)) {
      return;
    }
    set({
      state: 'QUESTIONNAIRE',
      questionnaire: answers,
      // V3 constraint 3: parse + confirm ⇒ purge the transient OCR state.
      pdfUri: null,
      ocrPages: null,
      draftValues: null,
      manualFallback: false,
      manualEntry: false,
    });
  },

  score: vector => {
    const s = get();
    if (s.state !== 'QUESTIONNAIRE' || !hasAllConfirmedValues(s.confirmedValues)) {
      return;
    }
    set({state: 'SCORING', vector});
  },

  scoreComplete: result => {
    if (get().state !== 'SCORING') {
      return;
    }
    set({state: 'RESULT', result});
  },

  acceptKit: voucher => {
    const s = get();
    // Voucher only for an ELEVATED/HIGH screening estimate.
    if (s.state !== 'RESULT' || s.result === null || s.result.tier === 'LOW') {
      return;
    }
    set({state: 'VOUCHER_ACCEPTED', voucher});
  },

  clearOcrDraft: () => {
    const s = get();
    if (
      s.state !== 'OCR_RUNNING' &&
      s.state !== 'CONFIRMING' &&
      s.state !== 'MANUAL_ENTRY'
    ) {
      return;
    }
    set({pdfUri: null, ocrPages: null, draftValues: null, manualFallback: false});
  },

  resetAll: () => set({...GATE1A_INITIAL_STATE}),

  deleteAll: () => get().resetAll(),
}));
