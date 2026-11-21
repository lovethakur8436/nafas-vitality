# NAFAS VITALITY — ARCHITECTURE
## Master Blueprint · V3 Edge-Native (2026-11-16)

**System:** Nafas Vitality — an Edge-Native Preventive Health platform for male-factor
reproductive risk, built as a 3-Gate locally-executed funnel.
**Supersedes:** V2 baseline (deliverables_2026-11-16.md) — same 3-Gate funnel, same
calibration math, same voucher economics; infrastructure pivoted to 100% on-device.
**One-line thesis:** All math, all OCR, all PII — on the phone. The cloud holds no
patient data at all; it holds one anonymous, randomized, coarse-grained event stream
that lets us prove the funnel works.

---

## 0. The Pivot: What V3 Changes vs V2

| V2 component | V3 fate | Why |
|---|---|---|
| ADHICS V2 Edge Gateway (PII strip) | **Removed** | Nothing PII-shaped ever reaches a server to strip. |
| Secret Identity Vault (break-glass mappings) | **Removed** | No identity is ever collected centrally; no mapping to protect or break. |
| HSM keystore (HMAC voucher seeds) | **Removed** | Vouchers become device-generated bearer codes; no central seed, no blind-QR redeem loop. |
| Restricted ML Cloud (model serving) | **Removed** | LightGBM/XGBoost compile to ONNX and execute locally via ONNX Runtime (WASM / native mobile). |
| FHIR lab bridge (1B panel ingestion) | **Removed** | Hormone values arrive as user-uploaded lab PDFs, OCR'd on-device. Zero lab API integrations. |
| Blind HMAC QR clinic redemption | **Removed** | Replaced by an anonymous differential-privacy webhook ping (coarse, randomized, unjoinable). |
| T1 on-device WASM scoring | **Kept, promoted** | T1 becomes *all* consent tiers for computation: every gate now runs on-device. |
| Bayesian prior-odds logit offset | **Kept, relocated** | The scalar offset ships inside the signed model bundle and is applied in the on-device runtime. |
| 3-Gate funnel + voucher unit of account | **Kept intact** | 1A Metabolic → 1B Toho 6-Hormone → 2 SEED-ML Drift. Cold-start logic unchanged. |

**Resulting cloud estate: exactly two surfaces —**
1. A signed-content CDN (app + model bundles; inbound to the device only).
2. One stateless differential-privacy telemetry endpoint (outbound from the device only).

---

## 1. Executive Vision — Edge-Native Preventive Health

**Nafas** means *breath*. The name is the promise: make the hardest preventive-health
conversation in male medicine easier to breathe through — including the conversation
with your own data.

**THE WALL.** Male factor contributes to roughly half of all infertility cases, and
first-line male workup still begins with a clinic visit and a semen analysis. Men don't
walk in, don't sample, don't come back. Every digital-health platform that starts at
the wall dies at the wall. Nafas Vitality starts behind the wall — with the routine
metabolic labs (IFHAS) most men already carry in their wallet — and with a model that
runs in their pocket, not in our data center.

**THE EDGE-NATIVE THESIS.** Preventive health is the one clinical domain where the
*decision* can be made where the *trust* lives. Our three gates are tabular,
low-dimensional, and explainable — exactly the class of models that compile to ONNX
and execute in milliseconds on a mid-range smartphone. So we execute them there. The
consequences are structural, not aspirational:

- **Zero cloud inference.** No model-serving fleet, no GPU spend, no per-inference
  marginal cost. A million screenings cost the same to compute as one.
- **Zero lab API integrations.** No FHIR middleware, no partner-lab contracts for data
  plumbing, no ingestion SLAs. The lab's existing report channel (email/SMS/portal)
  is our integration; on-device OCR is our parser.
- **Zero cloud vaults.** PII never leaves the phone. There is no vault to breach, no
  break-glass procedure to audit, no HSM ceremony to run, no cross-border transfer to
  argue about.
- **Zero cloud cost at the margin.** The only cloud we operate is a static CDN and one
  anonymous event endpoint. COGS per screened member is the physical kit and the
  phlebotomy draw — the part of the value chain that actually needs to happen.

**THE COLD-START PARADOX, SOLVED (unchanged).** Every screening product dies on the
same question: how do you get the data needed to decide whether the user needs the
product? Gate 1A never asks for data that doesn't exist. Gate 1B's data is *earned* —
the user receives the voucher as a reward for passing Gate 1, so the blood draw feels
like a benefit, not a cost. Gate 2's data is multi-channel and optional, so
non-engagement is a down-grade, not a dead end.

**TRUST AS A MOAT (re-positioned).** In V2 we could *promise* that T1 features never
left the phone. In V3 we can *demonstrate* it, because for every tier the answer is
identical: the computation happens on this device, the lab image is purged after the
user confirms the extracted values on screen, and the only bytes that ever leave are a
binned, randomized, non-identifiable event — which the user can watch leave. T3
consent is no longer "platform-mediated clinical sharing"; it is *user-controlled
export* — the app produces a results PDF and the user shares it with their clinician
by whatever means they choose. The platform never transmits a patient result on the
user's behalf, so there is nothing to leak.

**THE COMMERCIAL ENGINE (unchanged, now cheaper to deliver).** B2B2C: sold to insurers
and employer wellness programs as a low-cost pre-screening layer. Gate 1 filters out
most low-risk men before they ever see a specialist — the buyer pays for reduced
specialist load, not for tests. Revenue stack: program fee per screened member ·
home-kit fulfillment margin · per-completed-referral fee from partner clinics ·
risk-engine licensing (model bundles + the DP-KPI dashboard as the white-label ROI
widget). The voucher remains the unit of account: every voucher is a measurable funnel
step, and the DP telemetry proves funnel health to buyers with zero identity exposure
*and* zero marginal cloud cost. The compliance story and the commercial story are the
same story — now at near-zero infrastructure cost.

**POSITIONING LINE.**
"We don't ask men to walk into the lab. We ask the lab data they already have to talk
to a model that runs in their own pocket — and we never see the data either."

---

## 2. The 3-Gate Local Execution Funnel

### 2.1 Local execution substrate

**Model pipeline.** LightGBM / XGBoost (per the dataset strategy: tree ensembles as
the primary stack, class-weighted for the rare severe classes) are exported to ONNX
(onnxmltools / XGBoost native export) and bundled as a single signed artifact:

```
nafas-models-v3.x.x.bundle  (Ed25519-signed, versioned)
├── gate1a_metabolic.onnx        ≤ 3 MB   (~100-200 trees, metabolic + lifestyle features)
├── gate1b_toho_6hormone.onnx    ≤ 1 MB   (age + 6-hormone features)
├── gate2_seed_ml_drift.onnx     ≤ 4 MB   (drift + border-zone + molecular surrogate features)
├── prior_offset.json            (UAE general-screening prior, Toho clinic baseline,
│                                 logit-offset scalar + operating point)
├── shap_trees.json              (tree structure for on-device SHAP path traversal)
└── config.json                  (feature schema, units, version, threshold constants)
```

**Runtimes.**
- **React Native app** (primary): native ONNX Runtime Mobile (C++) bridged to RN —
  single inference path, no WASM tax.
- **PWA / web build** (secondary): onnxruntime-web (WASM, SIMD) — same ONNX artifacts,
  same bundle; cold-start ~150-300 ms, acceptable because it is a deliberate user action.
- **Tree SHAP on-device:** for tree ensembles, SHAP values are path traversals over the
  tree structure — trivially computable in the same runtime (<50 ms for ≤200 trees).
  Explainability is not a cloud service; it is a few extra instructions on the phone.

**Performance budget (mid-range 2022+ smartphone):**
| Operation | Budget |
|---|---|
| Model load (warm process) | < 500 ms |
| Inference, any single gate | < 20 ms |
| SHAP explanation, one row | < 50 ms |
| OCR per lab-report page (on-device) | 1–3 s |
| End-to-end gate result (OCR + confirm + infer) | < 10 s |

**Model updates:** OTA via CDN, signature-verified (Ed25519) before load; the device
pins the version it used for each result, and the model version is stamped into
telemetry events (so KPIs are attributable to a model generation). Rollout is a
canary on bundle hash, not a server-side deploy.

**On-device OCR (zero lab API).** Lab reports arrive as PDFs through the lab's own
existing channel (email / SMS / patient portal). The user uploads the PDF in-app; the
app rasterizes pages (PDFKit / Android PdfRenderer) and runs fully offline text
recognition:
- **Android:** Google ML Kit Text Recognition v2 (bundled mode — on-device, no network,
  Arabic + Latin script support for bilingual GCC lab reports).
- **iOS:** Apple Vision `VNRecognizeTextRequest` (on-device, Arabic + Latin).
Both sit behind one `LabOCR` interface in the RN layer.

**Extraction = OCR + ontology match + human confirm.** Recognized text is matched
against a closed panel ontology (test name → value + unit): IFHAS metabolic items for
Gate 1A; LH, FSH, total T, free T, estradiol, prolactin for Gate 1B; semen parameters
for Gate 2 channel (b). Every extracted value is rendered on a **confirmation screen**
where the user reviews and corrects values before inference. This is the OCR error
boundary: no lab value enters a model unconfirmed by the human who owns it. If OCR
confidence is below threshold, the app degrades to a clean manual-entry form — same
vector, same on-device inference, still zero APIs.

**On-device storage & retention.** Vectors live in encrypted on-device storage
(iOS Keychain / Android Keystore). Low-risk records purge automatically on a 30-day
TTL (carried over from V2); "delete all" is one tap and is total, because nothing was
ever sent.

### 2.2 GATE 1 — STAGE 1A · PASSIVE METABOLIC RADAR (local)

- **Input:** a routine IFHAS lab the user already has (uploaded PDF → on-device OCR →
  confirmed vector) plus the 5-minute lifestyle questionnaire (local).
- **Engine:** `gate1a_metabolic.onnx` (LightGBM → ONNX) in the local runtime.
- **Output:** an ordinal risk tier (Low / Elevated / High — screening estimate, never
  a diagnosis) with a top-3 plain-language SHAP explanation computed on-device, and —
  for above-threshold cohorts — a **home 6-hormone blood-spot voucher** minted
  locally as a device-generated bearer code (random 256-bit token + program code +
  30-day expiry). No network call is involved in minting; there is no central seed to
  protect because the code carries no identity to redeem against.
- **Why it is zero-friction:** it asks only for data that already exists. The single
  new action is tapping "accept home kit."
- **Why it is calibrated (carried over):** the trigger threshold is set so the
  voucher-eligible cohort carries prior odds of hormonal abnormality at least **Kx the
  UAE baseline rate**. The kit is economically justified by expected referral value
  before a single kit ships.

### 2.3 GATE 2 — STAGE 1B · TOHO 6-HORMONE ENGINE (local)

- **Input:** the user redeems the voucher at a partner lab / phlebotomy point (or DTC
  home draw). The lab result returns as a PDF through the lab's normal channel; the
  user uploads it in-app → on-device OCR → 6-hormone vector (LH, FSH, total T, free T,
  estradiol, prolactin) → on-screen confirmation. **No FHIR bridge, no lab API, and
  the phone is the only system that ever sees the values.**
- **Engine:** `gate1b_toho_6hormone.onnx` — the Toho University LightGBM model (age +
  the 6-hormone panel; up to 78.7% AUC for male-infertility risk stratification
  without semen analysis) — recalibrated with the Bayesian prior-odds logit offset,
  applied **on-device** (the offset is a scalar shipped in the bundle):

  ```
  p_screen = sigmoid( logit( p_toho ) + ln( odds_UAE_general / odds_toho_clinic ) )
  ```

- **Output:** a calibrated probability at a known operating point — not a binary
  "abnormal." Healthy men get a clear, not a scare. That is the difference between a
  product men share with their partners and a product they delete. The 1B score band
  is stamped into the result record and later echoed (coarsened) into telemetry —
  which is what makes the calibration claim falsifiable at scale (Section 3.3).
- **Fallbacks:** OCR failure → manual entry; missing free-T on some lab reports →
  feature-missingness indicator (model was trained with it); no PDF at all → the user
  types values, or defers (the funnel tolerates re-entry within the voucher TTL).

### 2.4 GATE 3 — STAGE 2 · SEED-ML DRIFT BRIDGE (local)

Engages only for users flagged Elevated/High at Gate 1B. **No forced semen
analysis.** Reproductive drift is triangulated through three user-chosen channels —
identical in shape to V2, now with every input path local:

- **(a) In-silico projection** — age + metabolic + hormonal trajectories from data the
  app already holds on-device. The 1A vector and 1B score are read locally; nothing is
  re-sent anywhere.
- **(b) Prior-lab OCR** — upload of a stale borderline clinic lab (semen parameters
  and/or hormones) → on-device OCR → confirmed structured parameters. Most men have a
  stale result somewhere; the image is purged after parse, exactly as in 1A.
- **(c) At-Home Dual-Kit** — T2-consented kit (count + motility), the strongest signal,
  genuinely optional; results arrive as the lab's own report PDF → same OCR path.

**Engine:** `gate2_seed_ml_drift.onnx` — the SEED-ML early-risk fusion (latent-pathology
classifier + anomaly layer + `n_borderline` fusion, calibrated) over the WHO
border-zone / SCD-surrogate feature space, degrading gracefully across channels:
in-silico alone keeps the funnel alive even if the user does nothing. **The funnel
never dead-ends.**

**Output:** drift score + triage decision (monitor | refer), with partial-dependence
evidence that the signal persists after controlling for WHO-defining parameters.

### 2.5 Deterministic triage layer (above all models)

Unchanged safety spine: a deterministic red-flag rule layer runs on-device above the
models — acute red flags (e.g., testicular pain) route to **URGENT_ASSESSMENT** with
in-app guidance for immediate clinician contact (mandatory escalation within 24 h).
Validated personas map to the five pathways: **SELF_CARE, PRIMARY_CARE,
ANDROLOGY_UROLOGY, FERTILITY_SERVICES, URGENT_ASSESSMENT**. Referral produces a
bearer **referral code** the user presents at the clinic; the model recommends, the
clinician decides.

### 2.6 Data-flow map (the entire system)

```
USER'S PHONE — all math, all OCR, all PII, all retention
┌──────────────────────────────────────────────────────────────────┐
│  Lab PDF (1A IFHAS / 1B hormones / 2 prior labs)                 │
│     └► ON-DEVICE OCR (ML Kit / Apple Vision, offline)            │
│          └► structured vector ─► USER CONFIRMS ON SCREEN         │
│                              (image purged after parse)          │
│  Questionnaire ──► metabolic vector                              │
│                                                                │
│  ONNX RUNTIME (ORT-Mobile / onnxruntime-web WASM)               │
│   GATE 1A metabolic model ──────► tier + local voucher code     │
│   GATE 1B Toho model + logit ───► calibrated probability        │
│   GATE 2  SEED-ML drift model ──► monitor | refer + referral    │
│   deterministic red-flag rules (above all models)               │
│                                                                │
│  Encrypted keystore · 30-day TTL · Low-risk auto-purge          │
└──────────────────────────────────────────────────────────────────┘
        │  outbound egress (only two exist)
        ├──►  DP TELEMETRY WEBHOOK  (binned + randomized event; no ID, no join)
        │        → stateless aggregator, UAE region → daily cohort dashboards
        └──►  (inbound) signed CDN — app + model bundles, Ed25519-verified
```

There is no third arrow. The diagram *is* the compliance posture.

---

## 3. Telemetry & Compliance Layer

### 3.1 Design

The V2 zero-knowledge KPI loop (blind HMAC QR + clinic scanner + vault-unjoinable KPI
store) is replaced by a deliberately simpler instrument: **the app pings a single
stateless webhook with a coarse, randomized, non-identifiable event.** No voucher
tokenization, no clinic scanner integration, no KPI store with join-risk — the event
itself carries no key that could ever be joined to anything.

**Why differential privacy is the right tool here:** the buyer's question is
aggregative ("what fraction of 25-30-year-old GCC nationals who completed Gate 2 got
referred?"), never individual ("did *this* man attend?"). A binned, locally
randomized event answers the aggregative question with a known, declared error
budget — and structurally cannot answer the individual one, because the individual
was never in the packet.

### 3.2 Event schema (closed world)

`POST /v1/telemetry` — every field is a closed enum, fixed band, or bounded integer.
No free text. No user ID. No session ID. No correlation key. No lab values, ever.

```json
{
  "v": "3.0",
  "t": "2026-11-16",
  "evt": "gate_completed",
  "gate": "1B",
  "age_band": "25-30",
  "natl_band": "GCC_NATIONAL",
  "score_q": 2,
  "model": "gate1b-toho-v3.2.1",
  "flag_rr": 1
}
```

| Field | Domain | Notes |
|---|---|---|
| `t` | day (date only) | No time-of-day; kills intra-day correlation. |
| `evt` | `onboard` · `gate_completed` · `voucher_issued` · `voucher_redeemed` · `referral_issued` · `referral_attended` · `result_exported` | `referral_attended` is self-attested in-app after clinic visit. |
| `gate` | `1A` · `1B` · `2` | For `gate_completed` / `referral_*` events. |
| `age_band` | `18-24` · `25-30` · `31-35` · `36-45` · `46-59` · `60+` | Coarse partition; never raw age. |
| `natl_band` | `GCC_NATIONAL` · `GCC_EXPAT` · `OTHER` | Macro-band; never nationality detail. |
| `score_q` | `1`–`4` | 1B score quartile; present only on `gate_completed`/`1B` — this is the calibration witness (3.3). |
| `model` | bundle version tag | Attributes every KPI to a model generation. |
| `flag_rr` | `0`/`1` | Randomized-response bit for binary self-attested flags (attended/redeemed): reported truthfully with p_r = 0.8, flipped with 0.2. |

**Local randomization (declared bound).** Each self-attested binary attribute is
emitted under **local differential privacy via randomized response** with truthfulness
probability p_r = 0.8 → per-attribute local ε = ln(p_r / (1−p_r)) = **ln 4 ≈ 1.39**,
independent per event, per user. Counts (cohort-level) additionally receive
geometric noise (b = 1) at aggregation. Demographic bands are a fixed coarse
partition (not randomized), with **cell suppression: only cells with n ≥ 30 are
published**; sub-30 cells are never stored in a queryable form. Because no identifier
or correlation key exists in the envelope, the published cells cannot be joined to
any other Nafas system — there is no vault on the other side of the join.

**Server.** One stateless endpoint in a **UAE region** (the only data we store
stays in-country, preserving the residency story for the one dataset we have). Raw
events are aggregated into daily cohort tables; per-event records are dropped after a
90-day window. The server holds no identity, no lab value, no vector, no token.
Right-to-erasure is satisfied by construction: there is nothing erasable to erase.

### 3.3 KPI reconstruction (B2B ROI, without identity or cost)

Server-side estimators over the daily tables:

1. **Gate-1 pass rate** = `voucher_issued` / `gate_completed[1A]`, per cohort band.
2. **Voucher redemption** = `voucher_redeemed` / `voucher_issued` (RR-debiased).
3. **Calibration (the falsifiable one):** join-free table of `score_q` (1B quartile)
   × 30-day referral/attendance outcome per band → **banded Brier approximation** of
   the Toho engine with the logit offset. The offset is falsifiable at scale, on the
   user's own device, with a coarse but honest statistic.
4. **30-day referral completion** = RR-debiased `referral_attended` within 30 days of
   `referral_issued`, per cohort band. Unbiased estimator under randomized response:
   `P(attend) = (P̂(flag_rr=1) − (1−p_r)) / (2·p_r − 1)` (with p_r = 0.8:
   `(P̂ − 0.2) / 0.6`).
5. **Funnel retention** 1A → 1B → 2 and per-gate completion, per age band × natl band
   (the fairness-audit input: flag any stratum >10% below the global mean).
6. **Re-screen uptake** (`result_exported` / `onboard` cycles) — the retention story
   for annual program renewals.

The DP-KPI dashboard is itself the white-label ROI widget sold to insurers and
employer programs: "here is your program's funnel health, with a declared error
budget, and zero of your members' data on our servers."

### 3.4 Consent tiers (re-positioned)

| Tier | Scope | What changes in V3 |
|---|---|---|
| **T1** | All on-device scoring (all three gates) + anonymous program telemetry | Telemetry is disclosed at onboarding in one plain line ("we send an anonymous, randomized counter to measure program quality — you can switch it off"). Revocation silently stops pings; no flag is pinged for the switch-off itself (the disable is itself a privacy choice, not an event). |
| **T2** | Home-kit fulfillment (voucher) | Voucher mint is fully local; T2 no longer activates any cloud component. |
| **T3** | Clinical sharing | Becomes **user-controlled export**: the app renders a results PDF (screening estimate + explanation + referral code); the user shares it with their clinician by any means. The platform never transmits a patient result on the user's behalf. |

Each tier remains independently grantable and revocable.

### 3.5 Compliance re-frame (ADHICS V2 at zero PII surface)

- **ADHICS V2 still governs the organization** (governance committee, incident
  response, audits) — but the *data class* at the core collapses: the central system
  holds no personal data, so there is no "Restricted" health payload, no identity
  mapping, and no break-glass workflow to operate or attest.
- **UAE data residency:** no cross-border PII transfer exists to discuss; the only
  stored data (coarse telemetry) resides in a UAE region by deployment choice.
- **Erasure & breach:** erasure is trivially satisfied (nothing central to erase;
  device deletion is total); a breach of the telemetry endpoint leaks no patient
  information by construction — the worst case is a corrupted counter.
- **Audit invariants (what we claim on stage):**
  - **E1** No user health data, lab image, or PII crosses any network boundary.
    (Schema-enforced: the only outbound envelope is the closed DP event; no
    free-text field exists anywhere in the egress surface.)
  - **E2** The telemetry endpoint holds no identifier, correlation key, or join path
    to any other system. (Closed schema + no identity field + n≥30 cell suppression.)
  - **E3** Every model is a signed, versioned artifact; every KPI row is attributable
    to a model generation. (Ed25519 bundle verification + `model` stamp.)
  - **E4** Each self-attested attribute is locally ε-DP (ε ≤ ln 4 ≈ 1.39 per
    attribute) plus geometric noise on aggregates; the bound is declared, not
    discovered. (Randomized response p_r = 0.8.)

### 3.6 Honest trade-offs of the simpler KPI instrument

- **Attendance is self-attested**, not scanner-verified as in the V2 blind-QR loop.
  Weaker evidence per event; mitigated by randomized-response debiasing, the
  `score_q` × outcome calibration table (which does not depend on attendance truth),
  and optional program-side reconciliation (the insurer's own claims data). For
  hackathon ROI and B2B funnel health, the weaker-but-cheaper signal is the right
  instrument; the blind-QR loop remains available as a documented V3.1 upgrade if a
  clinic partner wants it.
- **Calibration is banded**, not per-user: quartile × outcome band instead of exact
  probabilities. Coarser, but the logit offset is still falsifiable — direction and
  magnitude across quartiles survive the binning.
- **OCR is the new single point of data quality.** Mitigated by the user-confirm
  boundary (a human owns every value before inference) and the manual-entry fallback.
- **Model updates are OTA:** the fleet runs mixed bundle versions during rollout;
  telemetry's `model` stamp keeps KPIs clean across generations.

---

## 4. Sovereignty & Compute Assessment

**Data sovereignty, before → after:**

| Dimension | V2 | V3 |
|---|---|---|
| PII ever stored centrally | Yes (vault, encrypted, break-glass) | **No** |
| PII-adjacent cloud components | Edge gateway, identity vault, HSM keystore, Restricted ML Cloud, FHIR bridge | **0** |
| Erasure obligation | Central erasure pipeline + vault purge + audit trail | Device deletion is total; nothing central to erase |
| Cross-border transfer analysis | Required (mitigated by UAE residency) | Moot — no PII in transit anywhere |
| Break-glass / HSM ceremonies | Operated + attested | Eliminated |
| Worst-case breach | Identity mapping exposure | Corrupted anonymous counter |

The sovereignty story stops being a process we operate and becomes a property of the
topology: **there is no PII-bearing surface to defend, so the defense is the absence
of the surface.** That is a stronger claim than any control matrix, and it is
auditable by inspecting the two egress endpoints.

**Compute costs, before → after (per 100,000 screened members):**

| Cost line | V2 | V3 |
|---|---|---|
| Model serving (CPU/GPU fleet, autoscaling, on-call) | O(users × gates) | **0** (user's phone) |
| Vector feature store (de-identified vectors at rest) | O(users) storage + egress | **0** |
| Vault / HSM (secrets mgmt, ceremonies, audit) | Fixed infra + process cost | **0** |
| FHIR bridge + partner-lab integration | Per-partner integration + middleware | **0** (lab's own report channel) |
| KPI loop (blind QR, redeem service, KPI store) | Service + clinic scanner rollout | 1 stateless endpoint + daily aggregation |
| CDN (app + signed model bundles) | — | Trivial (static, versioned) |
| **Marginal digital COGS per screened member** | Non-trivial | **≈ 0** |

Physical COGS (kit, phlebotomy, referral fees) are unchanged — they are where the
value is. The digital layer, which V2 priced as infrastructure, is now priced as
negligible: the same platform that screens 100 members or 1,000,000 runs on
essentially the same cloud bill. That flat cost curve is the moat against every
cloud-inference competitor, and it is why "per-screened-member program fee" works at
scale.

---

## 5. Proof Metrics (defensible in Week 1)

1. **Gate-1 pass rate** — vouchers issued per screened member (per cohort band).
2. **Voucher redemption** — kits shipped vs labs completed (RR-debiased).
3. **Calibration** — banded Brier approximation of the 1B engine with the logit
   offset (falsifiable: the quartile × outcome table either supports or refutes the
   UAE prior adjustment).
4. **30-day referral completion** — RR-debiased, per cohort band, countable with a
   declared error budget and zero identity exposure.
5. **Funnel retention 1A→1B→2** with the fairness stratum check (flag any stratum
   >10% below the global mean).

---

## 6. Clinical & Licensing Boundaries (carried over, unchanged)

- **No autonomous diagnosis.** Ordinal screening bands + on-device explanations, never
  diagnoses. Every output carries: *"Screening estimate, not a diagnosis. Only a
  clinician with confirmed tests can diagnose."*
- **No bypassing human physicians.** Elevated/High route to human evaluation; acute
  red flags route to mandatory clinician escalation within 24 h. The AI recommends;
  the physician decides.
- **No treatment guidance.** No dosing, no protocols, no genetic testing or carrier
  screening in scope.
- **No longitudinal survival modeling.** Early risk is cross-sectional (bloodwork +
  drift); a longitudinal cohort is documented future work.
- **Licensing.** SEED-ML (CC BY 4.0) carries all productizable models; VISEM-derived
  findings remain research-only.
- **On-device OCR note.** OCR extracts values from *the user's own uploaded report*,
  for the user's own scoring; the app is not a lab-information system and issues no
  clinical interpretations of lab flags beyond the model's screening estimate.

---

**Bottom line.** The same three mathematically calibrated gates, the same voucher
economics, the same cultural UX — executed where the trust lives. V3 keeps every
clinical and commercial property of V2 while deleting the entire PII-bearing cloud:
no gateway, no vault, no HSM, no lab APIs, no model-serving fleet. What remains is a
signed model bundle on the phone and one anonymous, randomized, coarse event stream
that proves the funnel to the buyer. Edge-native is not a cost optimization layered
on the product; it *is* the product's trust story, its cost story, and its
compliance story, in one topology.
