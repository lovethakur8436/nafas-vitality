# Gate 1A Implementation Plan — Passive Metabolic Radar (V3 Edge-Native)

Date: 2026-11-17 · Status: ACTIVE
Scope: **Gate 1A only** (Stage 1A of the 3-Gate funnel). Gate 1B / Gate 2 are out of scope.
Sources of truth: `ARCHITECTURE.md` §2.1–2.6, §3 (telemetry); `deliverables_2026-11-16.md` (V2 baseline, carried over where V3 is silent).

## V3 hard constraints (every step must respect these)

1. **100% on-device.** No cloud API for OCR, scoring, or voucher minting. No network
   egress exists in Gate 1A at all — not even telemetry (DP telemetry is an outbound
   surface but is OUT of scope for Gate 1A; only a no-op interface stub is built).
2. **OCR error boundary is human-in-the-loop.** No lab value enters the model without
   user confirmation on screen. Low OCR confidence ⇒ degrade to clean manual-entry form
   (same vector, same inference).
3. **Image/PDF purged after parse + confirm.** Raw lab file never persists.
4. **Storage** is encrypted on-device (Keychain/Keystore), 30-day TTL, low-risk
   auto-purge, "delete all" is one tap and total.
5. **Voucher** = device-generated bearer code: random 256-bit token + program code +
   30-day expiry. No central seed, no network in minting. Accepting the kit = granting
   T2 consent (scope: hormone_panel).
6. **Model** is `gate1a_metabolic.onnx` (LightGBM→ONNX) via native ORT bridge. Until the
   signed bundle exists, an interface + deterministic mock implements the EXACT same
   I/O contract (vector in → tier + probability + top-3 SHAP out). No network in either.
7. **Output framing:** ordinal tier Low/Elevated/High is a *screening estimate, never a
   diagnosis*. Top-3 plain-language SHAP factors computed on-device.
8. Performance budgets (documented, enforced in mock): OCR 1–3 s/page, inference <20 ms,
   SHAP <50 ms, end-to-end <10 s.

## Verification strategy (headless environment — no emulator)

- `npx tsc --noEmit` — full strict type-check after every step.
- `npx jest` — unit tests per module; RN `jest` preset + `react-test-renderer` for UI.
- Native modules (ML Kit / Vision / ORT / Keystore) are behind TS interfaces with
  deterministic mocks; real native bindings are marked `TODO(native)` and added in a
  later, separate workstream (needs device).
- Every step ends GREEN (tsc + jest) before the next step starts.

## File map (target state)

```
package.json, tsconfig.json, babel.config.js, metro.config.js, index.js, App.tsx, jest.config.js
src/
  gate1a/
    types.ts                 # shared domain types (Step 2)
    ontology.ts              # closed IFHAS panel: ids, name aliases, units, ref ranges (Step 2)
    constants.ts             # thresholds, TTLs, voucher/program constants (Step 2)
    store.ts                 # Zustand state machine (Step 3)
    ocr/
      LabOCR.ts              # LabOCR interface (Step 4)
      MockLabOCRService.ts   # deterministic offline extraction fixture (Step 4)
      extraction.ts          # OCR text → ontology match, unit normalize, confidence gate (Step 5)
    engine/
      InferenceEngine.ts     # engine interface (Step 6)
      MockMetabolicModel.ts  # deterministic stand-in for gate1a_metabolic.onnx (Step 6)
      explain.ts             # top-3 plain-language SHAP (Step 7)
    voucher.ts               # bearer-code minting + T2 grant (Step 8)
    storage.ts               # encrypted store interface + mock, TTL (Step 9)
    screens/
      UploadScreen.tsx       # pick lab PDF → OCR progress (Step 10)
      ConfirmScreen.tsx      # human-in-the-loop value confirm + manual fallback (Step 11)
      QuestionnaireScreen.tsx# 5-min lifestyle form (Step 12)
      ResultScreen.tsx       # tier + SHAP top-3 + accept-kit CTA (Step 13)
    gate1a.test.tsx          # end-to-end jest flow (Step 14)
```

---

## STEPS (one file-group per step; execute strictly in order)

### Step 1 — Project scaffold
Files: `package.json`, `tsconfig.json`, `babel.config.js`, `metro.config.js`,
`index.js`, `jest.config.js`, `App.tsx`, `__tests__/App.test.tsx`, `.gitignore`.
- Deps: `react`, `react-native` (resolved 19.3.1 / 0.88.1), `zustand`; dev:
  `typescript`, `@types/react`, `jest`, `react-test-renderer`, `@types/jest`,
  `@types/react-test-renderer`, `@react-native/jest-preset`, `@react-native/babel-preset`.
- `tsconfig`: strict, `noEmit`, `jsx: react-jsx`, `skipLibCheck`.
- Babel: `presets: ['module:@react-native/babel-preset']` (old
  `metro-react-native-babel-preset` no longer exists).
- Jest: `preset: "@react-native/jest-preset"` (separate package since RN 0.85;
  `preset: "react-native"` no longer resolves).
- `App.tsx`: placeholder "Gate 1A scaffold" screen (replaced by Step 14).
  NOTE: core `SafeAreaView` is DEPRECATED in RN 0.88 (lazy require breaks jest
  teardown) — use plain `View` + padding in all screens.
- **Verify:** `npm install` → `npx tsc --noEmit` → `npx jest` (App render smoke test) all green.
- **PITFALL (affects Steps 10–13 UI tests):** React 19.3 + RN 0.88 web-based
  scheduler commits the initial render on a macrotask; `toJSON()` right after
  `ReactTestRenderer.create()` is `null`. Pattern (proven in `__tests__/App.test.tsx`):
  `const c = await act(async () => RTR.create(<X/>)); await new Promise(r => setTimeout(r, 0));`
  then assert on `c.toJSON()`.

### Step 2 — Domain types, IFHAS ontology, constants
Files: `src/gate1a/types.ts`, `src/gate1a/ontology.ts`, `src/gate1a/constants.ts` + `types.test.ts`.
- `types.ts`: `LabValue {testId, value:number, unit, confidence, source:'ocr'|'manual'}`,
  `MetabolicVector` (ordered feature vector matching model contract), `RiskTier
  'LOW'|'ELEVATED'|'HIGH'`, `Gate1AState` machine states, `Voucher`, `ShapFactor`.
- `ontology.ts`: closed IFHAS panel (test id, display name, name aliases incl. Arabic
  script variants, canonical unit, SI conversion map, reference range). Panel is closed:
  anything not matching ⇒ not extracted. ASSUMPTION: exact IFHAS item list is not
  enumerated in the docs — implement the standard metabolic panel (fasting glucose,
  HbA1c, total/direct/indirect bilirubin, ALT, AST, total protein, albumin, BUN,
  creatinine, uric acid, total cholesterol, LDL, HDL, triglycerides) as the default
  closed set, kept as data so config.json can override.
- `constants.ts`: OCR confidence thresholds (confirm-gate = 0.75), TTL 30 d,
  voucher program code, expiry 30 d, tier cut points (placeholders pending bundle
  config.json), performance budgets.
- **Verify:** tsc + unit tests (alias matching, unit normalization, panel closure).

### Step 3 — Zustand store (state machine)
File: `src/gate1a/store.ts` + `store.test.ts`.
- States: `IDLE → PDF_LOADED → OCR_RUNNING → CONFIRMING → QUESTIONNAIRE → SCORING
  → RESULT → VOUCHER_ACCEPTED`; error/`MANUAL_ENTRY` sub-branch from CONFIRMING.
- Actions: `loadPdf(uri)`, `startOcr()`, `ocrComplete(extraction)`,
  `confirmValue(testId, value)`, `switchToManual()`, `submitQuestionnaire(answers)`,
  `score(vector)`, `acceptKit(voucher)`, `deleteAll()`.
- Invariants: no inference call possible unless all confirmed values present;
  `deleteAll()` wipes vector + voucher; `confirmedAt` timestamps for TTL.
- **Verify:** tsc + state-machine transition tests (illegal transitions rejected).

### Step 4 — LabOCR interface + deterministic mock
Files: `src/gate1a/ocr/LabOCR.ts`, `src/gate1a/ocr/MockLabOCRService.ts` + tests.
- `LabOCR` interface: `recognizePdf(uri): Promise<OcrPage[]>` — pages of positioned
  text lines with per-line confidence; `purge(uri)`. Contract matches ML Kit v2
  (Android, bundled/offline) and Apple Vision (iOS, Arabic+Latin); real bindings
  `TODO(native)`.
- `MockLabOCRService`: deterministic fixture PDF → plausible bilingual lab-report text
  (with a few low-confidence lines and one non-panel line to exercise closure);
  simulates 1–3 s latency within budget.
- **Verify:** tsc + tests (latency budget, line confidence shape, purge called).

### Step 5 — Ontology matching & extraction pipeline
File: `src/gate1a/ocr/extraction.ts` + `extraction.test.ts`.
- Normalize OCR lines → candidate (testId, raw value, raw unit) via ontology aliases;
  SI unit conversion to canonical unit; per-value confidence; unmatched lines dropped.
- Confidence gate: per-value ≥ 0.75 ⇒ `source:'ocr'`; else flag `manual` for that
  value; any core value (fasting glucose, HbA1c, TG, T-chol, ALT, creatinine) missing
  or low-confidence ⇒ `fallback='manual_entry'` flag for the whole screen.
- Output: `ExtractionResult {values, missing[], fallback}`.
- **Verify:** tsc + table-driven tests (good/low-confidence/unknown-unit/Arabic line).

### Step 6 — Inference engine interface + mock model
Files: `src/gate1a/engine/InferenceEngine.ts`, `src/gate1a/engine/MockMetabolicModel.ts` + tests.
- Interface: `load(): Promise<void>`, `score(vector: MetabolicVector): Gate1AResult`,
  where `Gate1AResult = {tier, probability, modelVersion, shap: ShapFactor[]}`.
  Mirrors the ORT-native contract (feature order = ontology vector order, units from
  config). No I/O, no network — pure function of the vector.
- `MockMetabolicModel`: deterministic, monotone-in-risk (weights documented in-code),
  applies tier cut points from `constants.ts`; <20 ms budget; returns 3 SHAP features
  ranked by |contribution|. STAMPED as `modelVersion:'mock-0.0.1'` so the contract is
  identical to the signed-bundle path.
- **Verify:** tsc + tests (tier boundaries, determinism, budget, feature order).

### Step 7 — On-device SHAP explanation (plain language)
File: `src/gate1a/engine/explain.ts` + `explain.test.ts`.
- Maps top-3 `ShapFactor` → plain-language sentences ("Your fasting glucose is higher
  than the reference range — this is the biggest factor in this estimate.") with a
  "screening estimate, not a diagnosis" disclaimer constant.
- Budget <50 ms; pure function, on-device.
- **Verify:** tsc + snapshot tests of the 3 sentences per tier.

### Step 8 — Voucher minting + T2 grant
File: `src/gate1a/voucher.ts` + `voucher.test.ts`.
- `mintVoucher(rng): Voucher` — 256-bit random bearer token (32 B hex) from an
  injectable CSPRNG (RN: native secure RNG / `expo-crypto`; mock: seeded PRNG),
  program code from constants, `expiresAt = mintedAt + 30 d`. NO network, no seed
  beyond the random draw. `grantT2(voucher)` records consent
  `{scope:'hormone_panel', at, voucherId}` on-device.
- **Verify:** tsc + tests (token length/entropy shape, expiry math, T2 record,
  determinism under seeded RNG).

### Step 9 — Encrypted on-device storage + TTL
File: `src/gate1a/storage.ts` + `storage.test.ts`.
- Interface: `save(record) / load(id) / deleteAll()` over encrypted keystore
  (Keychain/Keystore — `TODO(native)`; mock = in-memory with TTL clock injection).
- 30-day TTL sweep on load; low-risk records auto-purge; `deleteAll()` total.
- **Verify:** tsc + tests (TTL expiry, deleteAll empties, TTL clock injection).

### Step 10 — UploadScreen (PDF → OCR)
File: `src/gate1a/screens/UploadScreen.tsx` + render test.
- Pick lab PDF (document picker — interface `pickLabPdf()`, `TODO(native)` + mock),
  show OCR progress within 1–3 s budget, on completion `ocrComplete()` → store,
  trigger `purge(uri)` immediately after parse (per constraint 3).
- **Verify:** tsc + react-test-renderer test (pick → progress → confirm transition,
  purge called).

### Step 11 — ConfirmScreen (human-in-the-loop OCR boundary)
File: `src/gate1a/screens/ConfirmScreen.tsx` + render test.
- Renders every extracted value with unit + confidence badge; per-field editable
  (edit ⇒ `source:'manual'`); "not in your report / I can't read it" ⇒ clear field.
- Manual-entry fallback form when `fallback==='manual_entry'` (same fields, no
  confidence gate). "Confirm all values" enabled only when required core values are
  present ⇒ store `submitConfirmed()` → QUESTIONNAIRE.
- **Verify:** tsc + renderer test (edit overrides ocr source; missing core blocks
  confirm; fallback form renders on low-confidence fixture).

### Step 12 — QuestionnaireScreen (5-min lifestyle)
File: `src/gate1a/screens/QuestionnaireScreen.tsx` + render test.
- Fixed 8-item lifestyle form (age, BMI self-report, exercise, smoking, alcohol,
  sleep, family history, waist) — local only; maps to lifestyle half of
  `MetabolicVector`; submit ⇒ `score()` ⇒ SCORING.
- **Verify:** tsc + renderer test (all required answered before enable; vector
  assembly order matches ontology contract).

### Step 13 — ResultScreen (tier + SHAP + voucher CTA)
File: `src/gate1a/screens/ResultScreen.tsx` + render test.
- Shows tier (screening-estimate disclaimer), top-3 plain-language factors.
- LOW ⇒ "no action needed" path, record flagged for 30-day auto-purge.
- ELEVATED/HIGH ⇒ "Accept home kit" ⇒ `mintVoucher` + `grantT2` ⇒ shows bearer code
  + expiry; decline ⇒ keep result, no voucher.
- "Delete all" one tap ⇒ storage wipe, store → IDLE.
- **Verify:** tsc + renderer test (per-tier CTA, voucher shown only after accept,
  deleteAll resets state + storage).

### Step 14 — App wiring + end-to-end test
Files: `App.tsx` (state-driven screen router), `src/gate1a/gate1a.test.tsx`.
- E2E jest: mock OCR fixture → confirm (with one manual edit) → questionnaire →
  score → Elevated result → accept kit → voucher persisted → deleteAll. Asserts at
  each hop: no network import touched (import guard test), purge called, TTL stamped.
- **Verify:** tsc + full jest suite green = Gate 1A implementation complete.

## Execution protocol
- One step per turn. Each step: read its spec above → write its files → run
  `npx tsc --noEmit` + `npx jest` → report green/red → STOP and await permission.
- No step may import from a step not yet built.
