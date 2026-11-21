/**
 * Gate 1A — ConfirmScreen (Step 11, the human-in-the-loop boundary).
 *
 * The only Gate 1A screen that trusts the user's eyes over the OCR. It
 * renders every extracted panel value with its canonical unit and a
 * confidence badge; the user confirms the OCR read or edits the field.
 * Editing away from the draft (or any confirm in manual mode) stamps the
 * stored value `source:'manual'`, confidence 1.0 — V3 constraint 2. When the
 * extraction forced a manual-entry fallback (no confident reads), the screen
 * enters MANUAL_ENTRY on mount: same fields, no confidence badges, every
 * confirm stamped manual.
 *
 * "Confirm all values" is enabled only once all six core values are
 * confirmed (`hasAllConfirmedValues`). It does not itself change the store
 * state — the App router (Step 14) swaps to the questionnaire once the gate
 * opens, and the CONFIRMING→QUESTIONNAIRE transition is taken by
 * `submitQuestionnaire` (Step 12), which also records the answers.
 *
 * UI: plain <View> tree (RN 0.88, no NavigationContainer). Subscribes to the
 * store via the useGate1AStore hook so it re-renders as values confirm.
 *
 * @format
 */

import {useEffect, useState} from 'react';
import {StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {METABOLIC_FEATURE_ORDER, OCR_CONFIDENCE_GATE} from '../constants';
import {getEntry} from '../ontology';
import {hasAllConfirmedValues, useGate1AStore} from '../store';

export interface ConfirmScreenProps {
  /**
   * Optional callback fired when all six values are confirmed and the user
   * taps "Confirm all values". The App router (Step 14) wires this to
   * navigation; in isolation (tests) it is a no-op.
   */
  readonly onAllConfirmed?: () => void;
}

export default function ConfirmScreen({onAllConfirmed}: ConfirmScreenProps) {
  const state = useGate1AStore(s => s.state);
  const draftValues = useGate1AStore(s => s.draftValues);
  const confirmedValues = useGate1AStore(s => s.confirmedValues);
  const manualFallback = useGate1AStore(s => s.manualFallback);
  const manualEntry = useGate1AStore(s => s.manualEntry);

  const inManualMode = manualEntry || manualFallback;

  // Editable text per field, seeded once from the OCR draft.
  const [texts, setTexts] = useState<Record<string, string>>(() => {
    const t: Record<string, string> = {};
    for (const id of METABOLIC_FEATURE_ORDER) {
      const d = draftValues?.[id];
      t[id] = d != null ? String(d.value) : '';
    }
    return t;
  });

  // The extraction flagged the whole screen for manual entry: enter the
  // MANUAL_ENTRY sub-branch on mount so every confirm is stamped manual and
  // no confidence badges are shown.
  useEffect(() => {
    if (manualFallback && state === 'CONFIRMING' && !manualEntry) {
      useGate1AStore.getState().switchToManual();
    }
    // Intentionally mount-once: the fallback flag is set before this screen
    // mounts and never flips back to a lower-confidence screen on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allConfirmed = hasAllConfirmedValues(confirmedValues);

  const setField = (id: string, value: string) =>
    setTexts(prev => ({...prev, [id]: value}));

  const confirmField = (id: string) => {
    const n = Number(texts[id]);
    if (!Number.isFinite(n)) {
      return;
    }
    useGate1AStore.getState().confirmValue(id, n);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>
        {inManualMode ? 'Enter your values' : 'Confirm your values'}
      </Text>
      <Text style={styles.subtitle}>
        {inManualMode
          ? 'Type each value from your report. Nothing leaves this phone.'
          : 'Check each value read from your report. Edit any that look wrong.'}
      </Text>

      {METABOLIC_FEATURE_ORDER.map(id => {
        const entry = getEntry(id)!;
        const draft = draftValues?.[id];
        const confirmed = confirmedValues[id];
        const low = draft != null && draft.confidence < OCR_CONFIDENCE_GATE;
        return (
          <View key={id} style={styles.field}>
            <View style={styles.fieldHead}>
              <Text style={styles.fieldName}>{entry.displayName}</Text>
              <Text style={styles.fieldUnit}>{entry.canonicalUnit}</Text>
            </View>
            {!inManualMode && draft != null && (
              <View
                testID={`confirm-badge-${id}`}
                style={[styles.badge, low ? styles.badgeLow : styles.badgeHi]}>
                <Text style={styles.badgeText}>
                  {low
                    ? `needs review · ${Math.round(draft.confidence * 100)}%`
                    : `read · ${Math.round(draft.confidence * 100)}%`}
                </Text>
              </View>
            )}
            <TextInput
              testID={`confirm-field-${id}`}
              style={styles.input}
              value={texts[id] ?? ''}
              onChangeText={value => setField(id, value)}
              keyboardType="decimal-pad"
              placeholder="—"
            />
            <TouchableOpacity
              testID={`confirm-ok-${id}`}
              accessibilityRole="button"
              style={[
                styles.smallBtn,
                confirmed ? styles.smallBtnDone : styles.smallBtnPrimary,
              ]}
              onPress={() => confirmField(id)}>
              <Text style={styles.smallBtnText}>
                {confirmed ? 'Confirmed' : 'Confirm'}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}

      {manualEntry && (
        <TouchableOpacity
          testID="confirm-back-to-ocr"
          accessibilityRole="button"
          style={styles.textBtn}
          onPress={() => useGate1AStore.getState().switchToManual()}>
          <Text style={styles.textBtnText}>← Back to OCR values</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        testID="confirm-all"
        accessibilityRole="button"
        style={[styles.button, !allConfirmed && styles.buttonDisabled]}
        disabled={!allConfirmed}
        onPress={() => {
          if (allConfirmed) {
            onAllConfirmed?.();
          }
        }}>
        <Text style={styles.buttonText}>Confirm all values</Text>
      </TouchableOpacity>
      {!allConfirmed && (
        <Text style={styles.hint}>Confirm every value to continue.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {padding: 20, backgroundColor: '#fff'},
  title: {fontSize: 22, fontWeight: '700', marginBottom: 6},
  subtitle: {fontSize: 14, color: '#666', marginBottom: 16},
  field: {
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  fieldHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  fieldName: {fontSize: 15, fontWeight: '600'},
  fieldUnit: {fontSize: 12, color: '#888'},
  badge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  badgeHi: {backgroundColor: '#e8f5e9'},
  badgeLow: {backgroundColor: '#fff3e0'},
  badgeText: {fontSize: 11},
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 8,
    fontSize: 16,
    marginBottom: 8,
  },
  smallBtn: {
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#f0f0f0',
    alignSelf: 'flex-start',
  },
  smallBtnPrimary: {backgroundColor: '#4a90d9'},
  smallBtnDone: {backgroundColor: '#c8e6c9'},
  smallBtnText: {fontSize: 13},
  textBtn: {alignSelf: 'flex-start', marginBottom: 12, padding: 4},
  textBtnText: {fontSize: 13, color: '#4a90d9'},
  button: {
    borderRadius: 8,
    backgroundColor: '#4a90d9',
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {backgroundColor: '#cfcfcf'},
  buttonText: {color: '#fff', fontSize: 16, fontWeight: '600'},
  hint: {marginTop: 8, fontSize: 12, color: '#999', textAlign: 'center'},
});
