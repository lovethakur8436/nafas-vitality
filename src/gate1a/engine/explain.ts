/**
 * Gate 1A — on-device SHAP explanation in plain language (Step 7).
 *
 * Maps the top-3 `ShapFactor`s of a `Gate1AResult` into plain-language
 * sentences for ResultScreen (Step 13), plus the screening disclaimer
 * constant (V3 constraint 7: a screening estimate, never a diagnosis).
 *
 * Pure function of the factors: no I/O, no network, no state — everything
 * runs on-device. Budget <50 ms (PERFORMANCE_BUDGETS_MS.shap), asserted in
 * explain.test.ts.
 *
 * Copy is keyed by model feature (the 16 mock feature keys; the signed
 * bundle uses the same ontology / lifestyle key space). Direction words are
 * fixed per feature kind, matching the mock model's monotone-in-risk design:
 * a POSITIVE contribution from a protective feature (HDL, exercise, sleep)
 * means that feature runs LOW, so its sentence reads "lower than the
 * reference range". A contribution at zero is reported neutrally — never as
 * "higher/lower than the reference range" — so a padded zero factor can
 * never make a false range claim.
 *
 * @format
 */

import {SCREENING_DISCLAIMER} from '../constants';
import type {ShapFactor} from '../types';

/** The mock reports exactly this many factors (Step 6); we explain this many. */
export const SHAP_TOP_K = 3;

/** |contribution| below this is treated as "no signal" (zero contribution). */
const ZERO_CONTRIBUTION_EPS = 1e-9;

/**
 * Plain-language copy per feature. `range` features are described against
 * the ontology reference range with a fixed direction (risk features read
 * "higher", protective ones "lower"); `flag` features are questionnaire
 * red flags and read "you reported …".
 */
type FactorCopy =
  | {
      readonly kind: 'range';
      readonly label: string;
      readonly direction: 'higher' | 'lower';
    }
  | {
      readonly kind: 'flag';
      readonly label: string;
    };

const FACTOR_COPY: Readonly<Record<string, FactorCopy>> = {
  // Closed-panel biomarkers (lab feature keys = ontology test ids).
  hba1c: {kind: 'range', label: 'HbA1c', direction: 'higher'},
  fasting_glucose: {kind: 'range', label: 'fasting glucose', direction: 'higher'},
  triglycerides: {kind: 'range', label: 'triglycerides', direction: 'higher'},
  hdl: {kind: 'range', label: 'HDL cholesterol', direction: 'lower'},
  total_cholesterol: {
    kind: 'range',
    label: 'total cholesterol',
    direction: 'higher',
  },
  hs_crp: {
    kind: 'range',
    label: 'hs-CRP (an inflammation marker)',
    direction: 'higher',
  },
  // Derived ratios (anthropometrics enter only through these).
  bmi: {kind: 'range', label: 'BMI', direction: 'higher'},
  whtr: {kind: 'range', label: 'waist-to-height ratio', direction: 'higher'},
  tyg_index: {
    kind: 'range',
    label: 'Tyg index (a glucose-lipid marker)',
    direction: 'higher',
  },
  // Numeric lifestyle questionnaire.
  age_years: {kind: 'range', label: 'age', direction: 'higher'},
  exercise_minutes_per_week: {
    kind: 'range',
    label: 'weekly exercise',
    direction: 'lower',
  },
  alcohol_drinks_per_week: {
    kind: 'range',
    label: 'alcohol intake',
    direction: 'higher',
  },
  sleep_hours_per_night: {kind: 'range', label: 'sleep', direction: 'lower'},
  // Red-flag booleans.
  smoking: {kind: 'flag', label: 'current smoking'},
  hypertension: {kind: 'flag', label: 'high blood pressure (hypertension)'},
  family_history_t2d: {
    kind: 'flag',
    label: 'a family history of type 2 diabetes',
  },
};

const RANK_WORDS = ['biggest', 'second biggest', 'third biggest'] as const;

export interface ShapExplanation {
  /** Exactly SHAP_TOP_K sentences, ranked by |contribution| (biggest first). */
  readonly sentences: readonly string[];
  /** V3 constraint 7 framing — shown together with the factors. */
  readonly disclaimer: string;
}

/**
 * Turn the top-3 SHAP factors of a result into plain-language sentences.
 * Re-ranks by |contribution| (stable) so the input order does not matter;
 * unknown feature keys degrade to a neutral sentence instead of throwing,
 * so a future bundle with new feature keys cannot crash ResultScreen.
 */
export function explainTopFactors(shap: readonly ShapFactor[]): ShapExplanation {
  const ranked = [...shap]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, SHAP_TOP_K);
  return {
    sentences: ranked.map((factor, i) =>
      sentenceFor(factor, RANK_WORDS[i]),
    ),
    disclaimer: SCREENING_DISCLAIMER,
  };
}

function sentenceFor(factor: ShapFactor, rankWord: string): string {
  const tail = `this is the ${rankWord} factor in this estimate`;
  const copy = FACTOR_COPY[factor.featureKey];

  // Unknown key (future bundle feature): neutral, never a false claim.
  if (copy === undefined) {
    return `A model factor (${factor.featureKey}) contributed to this estimate.`;
  }

  // Zero-contribution factor (the mock pads top-3 with zeros on low-risk
  // profiles): report it neutrally, never "higher/lower than the range".
  if (Math.abs(factor.contribution) < ZERO_CONTRIBUTION_EPS) {
    return `This factor does not push this estimate up.`;
  }

  if (copy.kind === 'flag') {
    return `You reported ${copy.label} — ${tail}.`;
  }
  return `Your ${copy.label} is ${copy.direction} than the reference range — ${tail}.`;
}
