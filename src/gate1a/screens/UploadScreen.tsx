/**
 * Gate 1A — UploadScreen: pick a lab PDF → on-device OCR → confirm handoff
 * (Step 10).
 *
 * Flow: idle → pick (LabPdfPicker, TODO(native) + mock) → `loadPdf` →
 * `startOcr` → `LabOCR.recognizePdf` (1-3 s per-page budget) →
 * `extractValues` → `ocrComplete` → `LabOCR.purge(uri)` IMMEDIATELY after
 * parse (V3 constraint 3: the raw lab file is never persisted).
 *
 * The screen drives the store imperatively through
 * `useGate1AStore.getState()`: this is a one-shot launcher, and the App
 * router (Step 14) swaps in the ConfirmScreen once the machine reaches
 * CONFIRMING. On an OCR failure the machine is parked in OCR_RUNNING
 * (loadPdf/startOcr cannot re-enter from there), so the screen calls
 * `resetAll()` and offers a re-pick.
 *
 * RN 0.88 note: core SafeAreaView is deprecated — plain View + padding.
 *
 * @format
 */

import {useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import {useGate1AStore} from '../store';
import {extractValues} from '../ocr/extraction';
import {isOcrError, type LabOCR} from '../ocr/LabOCR';

/**
 * Document-picker contract. TODO(native): wrap the platform document
 * picker (Android SAF / iOS document browser). The mock below is used in
 * tests.
 */
export interface LabPdfPicker {
  /** Resolves with the picked PDF file URI, or null when cancelled. */
  pickLabPdf(): Promise<string | null>;
}

/** Deterministic mock picker: replays the queued URIs in order. */
export class MockLabPdfPicker implements LabPdfPicker {
  private readonly queue: readonly (string | null)[];
  private index = 0;
  /** Every uri handed out, in pick order (null = cancel). Test-only. */
  readonly picked: (string | null)[] = [];

  constructor(queue: readonly (string | null)[]) {
    this.queue = queue;
  }

  pickLabPdf(): Promise<string | null> {
    const uri =
      this.queue.length > 0
        ? this.queue[Math.min(this.index, this.queue.length - 1)]
        : null;
    this.index += 1;
    this.picked.push(uri);
    return Promise.resolve(uri);
  }
}

export interface UploadScreenProps {
  /** On-device OCR engine (MockLabOCRService in tests; native later). */
  readonly ocr: LabOCR;
  /** Document picker (mock in tests; native later). */
  readonly picker: LabPdfPicker;
}

type Phase = 'idle' | 'reading' | 'error' | 'done';

export default function UploadScreen({ocr, picker}: UploadScreenProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const busy = useRef(false);

  const start = async (): Promise<void> => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setErrorMessage(null);
    try {
      const uri = await picker.pickLabPdf();
      if (uri === null) {
        // User cancelled — the machine does not move.
        return;
      }
      setPhase('reading');
      const store = useGate1AStore.getState();
      if (store.state !== 'IDLE' && store.state !== 'PDF_LOADED') {
        // The machine already advanced past this screen — it is stale.
        return;
      }
      store.loadPdf(uri);
      store.startOcr();
      const result = await ocr.recognizePdf(uri);
      const extraction = extractValues(result);
      useGate1AStore.getState().ocrComplete(extraction);
      // V3 constraint 3: the raw lab file is never persisted — purge
      // immediately after parse (structured text already in memory).
      await ocr.purge(uri);
      setPhase('done');
    } catch (e) {
      // OCR failed: park the machine back at IDLE (see file header) and
      // let the user re-pick.
      useGate1AStore.getState().resetAll();
      setPhase('error');
      setErrorMessage(
        isOcrError(e)
          ? `Could not read that report (${e.code}). Please try another scan.`
          : 'Something went wrong while reading the report.',
      );
    } finally {
      busy.current = false;
    }
  };

  if (phase === 'reading') {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Reading your report…</Text>
        <Text style={styles.hint}>
          On-device OCR: 1-3 seconds per page. Nothing leaves this phone.
        </Text>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.root}>
        <Text style={styles.error}>{errorMessage}</Text>
        <TouchableOpacity
          testID="upload-retry"
          accessibilityRole="button"
          style={styles.button}
          onPress={start}>
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Reading complete</Text>
        <Text style={styles.hint}>Next: confirm your values.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Your lab report</Text>
      <Text style={styles.subtitle}>
        Pick the PDF of your latest metabolic panel. It is read entirely on
        this phone and deleted right after.
      </Text>
      <TouchableOpacity
        testID="upload-pick"
        accessibilityRole="button"
        style={styles.button}
        onPress={start}>
        <Text style={styles.buttonText}>Select lab report</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, padding: 24},
  title: {fontSize: 22, fontWeight: '600', marginBottom: 8},
  subtitle: {fontSize: 15, color: '#444444', marginBottom: 24},
  hint: {fontSize: 15, color: '#444444'},
  error: {fontSize: 15, color: '#B00020', marginBottom: 24},
  button: {
    backgroundColor: '#0B6E4F',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 14,
  },
  buttonText: {color: '#FFFFFF', fontSize: 16, fontWeight: '600'},
});
