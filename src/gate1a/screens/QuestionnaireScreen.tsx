/**
 * Gate 1A — QuestionnaireScreen (Step 12, the 5-min lifestyle form).
 *
 * Collects the lifestyle half of the MetabolicVector: the numeric
 * lifestyle/anthropometric fields plus the 3 red-flag booleans. Everything
 * stays local (V3 constraint 4). On submit it records the answers
 * (`submitQuestionnaire`, CONFIRMING→QUESTIONNAIRE) and assembles the full
 * vector in ontology order (`METABOLIC_FEATURE_ORDER`), then scores it
 * (`score`, →SCORING).
 *
 * The plan lists "BMI self-report" as one item; the vector's anthropometrics
 * needs height + weight (they feed the derived bmi/whtr ratios), so the form
 * collects height + weight and derives the BMI that fills `bmi_self_reported`.
 *
 * UI: plain <View> tree (RN 0.88, no NavigationContainer). Submit is enabled
 * only when every field is answered (numeric finite & non-negative, each
 * red-flag explicitly Yes/No).
 *
 * @format
 */

import {useMemo, useState} from 'react';
import {StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {METABOLIC_FEATURE_ORDER} from '../constants';
import {computeDerivedRatios} from '../ontology';
import {useGate1AStore} from '../store';
import type {QuestionnaireAnswers} from '../store';
import type {Anthropometrics, MetabolicVector} from '../types';

export interface QuestionnaireScreenProps {
  /** Optional: fired right after the store reaches SCORING (Step 14 wiring). */
  readonly onSubmitted?: () => void;
}

const NUMERIC_FIELDS = [
  {key: 'age_years', label: 'Age', unit: 'years', testId: 'q-age'},
  {key: 'height_cm', label: 'Height', unit: 'cm', testId: 'q-height'},
  {key: 'weight_kg', label: 'Weight', unit: 'kg', testId: 'q-weight'},
  {key: 'waist_cm', label: 'Waist', unit: 'cm', testId: 'q-waist'},
  {
    key: 'exercise_minutes_per_week',
    label: 'Exercise',
    unit: 'min/week',
    testId: 'q-exercise',
  },
  {
    key: 'alcohol_drinks_per_week',
    label: 'Alcohol',
    unit: 'drinks/week',
    testId: 'q-alcohol',
  },
  {
    key: 'sleep_hours_per_night',
    label: 'Sleep',
    unit: 'hours/night',
    testId: 'q-sleep',
  },
] as const;

const BOOLEAN_FIELDS = [
  {key: 'smoking', label: 'Current smoker?', testId: 'q-smoking'},
  {
    key: 'hypertension',
    label: 'High blood pressure (diagnosed)?',
    testId: 'q-hypertension',
  },
  {
    key: 'family_history_t2d',
    label: 'Parent or sibling with type 2 diabetes?',
    testId: 'q-family',
  },
] as const;

/** Lightweight deterministic hash (hex) for the vector audit trail. */
function contentHash(parts: unknown): string {
  const s = JSON.stringify(parts);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export default function QuestionnaireScreen({
  onSubmitted,
}: QuestionnaireScreenProps) {
  const [numeric, setNumeric] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const f of NUMERIC_FIELDS) {
      o[f.key] = '';
    }
    return o;
  });
  const [booleans, setBooleans] = useState<Record<string, boolean | null>>(
    () => {
      const o: Record<string, boolean | null> = {};
      for (const f of BOOLEAN_FIELDS) {
        o[f.key] = null;
      }
      return o;
    },
  );

  const allAnswered = useMemo(() => {
    const numericOk = NUMERIC_FIELDS.every(f => {
      const raw = numeric[f.key];
      const n = Number(raw);
      return raw !== '' && Number.isFinite(n) && n >= 0;
    });
    const booleanOk = BOOLEAN_FIELDS.every(f => booleans[f.key] !== null);
    return numericOk && booleanOk;
  }, [numeric, booleans]);

  const submit = () => {
    if (!allAnswered) {
      return;
    }
    const s = useGate1AStore.getState();
    const height = Number(numeric.height_cm);
    const weight = Number(numeric.weight_kg);
    const waist = Number(numeric.waist_cm);
    const fastingGlucose = s.confirmedValues.fasting_glucose;
    const triglycerides = s.confirmedValues.triglycerides;
    if (fastingGlucose === undefined || triglycerides === undefined) {
      return;
    }

    const answers: QuestionnaireAnswers = {
      age_years: Number(numeric.age_years),
      exercise_minutes_per_week: Number(numeric.exercise_minutes_per_week),
      alcohol_drinks_per_week: Number(numeric.alcohol_drinks_per_week),
      sleep_hours_per_night: Number(numeric.sleep_hours_per_night),
      waist_cm: waist,
      bmi_self_reported: weight / Math.pow(height / 100, 2),
      smoking: booleans.smoking === true,
      hypertension: booleans.hypertension === true,
      family_history_t2d: booleans.family_history_t2d === true,
    };
    // CONFIRMING | MANUAL_ENTRY → QUESTIONNAIRE (records answers, purges OCR).
    s.submitQuestionnaire(answers);

    // Assemble the vector in ontology order and score it (→ SCORING).
    const anthropometrics: Anthropometrics = {
      height_cm: height,
      weight_kg: weight,
      waist_cm: waist,
    };
    const lifestyle = {
      age_years: answers.age_years,
      exercise_minutes_per_week: answers.exercise_minutes_per_week,
      alcohol_drinks_per_week: answers.alcohol_drinks_per_week,
      sleep_hours_per_night: answers.sleep_hours_per_night,
    };
    const redFlags = {
      smoking: answers.smoking,
      hypertension: answers.hypertension,
      family_history_t2d: answers.family_history_t2d,
    };
    const core = {
      values: METABOLIC_FEATURE_ORDER.map(id => s.confirmedValues[id]!),
      anthropometrics,
      derived: computeDerivedRatios(
        anthropometrics,
        fastingGlucose.value,
        triglycerides.value,
      ),
      lifestyle,
      redFlags,
    };
    const vector: MetabolicVector = {
      ...core,
      assembledAt: Date.now(),
      contentHash: contentHash(core),
    };
    useGate1AStore.getState().score(vector);
    onSubmitted?.();
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>About you</Text>
      <Text style={styles.subtitle}>
        A few questions to refine the estimate. Answered on this phone only —
        nothing is sent anywhere.
      </Text>

      {NUMERIC_FIELDS.map(f => (
        <View key={f.key} style={styles.field}>
          <View style={styles.fieldHead}>
            <Text style={styles.fieldName}>{f.label}</Text>
            <Text style={styles.fieldUnit}>{f.unit}</Text>
          </View>
          <TextInput
            testID={f.testId}
            style={styles.input}
            value={numeric[f.key]}
            onChangeText={v => setNumeric(prev => ({...prev, [f.key]: v}))}
            keyboardType="decimal-pad"
            placeholder="0"
          />
        </View>
      ))}

      {BOOLEAN_FIELDS.map(f => (
        <View key={f.key} style={styles.field}>
          <Text style={styles.fieldName}>{f.label}</Text>
          <View style={styles.row}>
            <TouchableOpacity
              testID={`${f.testId}-yes`}
              accessibilityRole="button"
              style={[
                styles.smallBtn,
                booleans[f.key] === true && styles.smallBtnActive,
              ]}
              onPress={() =>
                setBooleans(prev => ({...prev, [f.key]: true}))
              }>
              <Text style={styles.smallBtnText}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID={`${f.testId}-no`}
              accessibilityRole="button"
              style={[
                styles.smallBtn,
                booleans[f.key] === false && styles.smallBtnActive,
              ]}
              onPress={() =>
                setBooleans(prev => ({...prev, [f.key]: false}))
              }>
              <Text style={styles.smallBtnText}>No</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <TouchableOpacity
        testID="questionnaire-submit"
        accessibilityRole="button"
        style={[styles.button, !allAnswered && styles.buttonDisabled]}
        disabled={!allAnswered}
        onPress={submit}>
        <Text style={styles.buttonText}>Calculate my risk</Text>
      </TouchableOpacity>
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
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 8,
    fontSize: 16,
  },
  row: {flexDirection: 'row', gap: 8, marginTop: 8},
  smallBtn: {
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#f0f0f0',
  },
  smallBtnActive: {backgroundColor: '#4a90d9'},
  smallBtnText: {fontSize: 13},
  button: {
    borderRadius: 8,
    backgroundColor: '#4a90d9',
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {backgroundColor: '#cfcfcf'},
  buttonText: {color: '#fff', fontSize: 16, fontWeight: '600'},
});
