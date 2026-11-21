NAFAS VITALITY — HACKATHON DELIVERABLES (2026-11-16)
Abu Dhabi Future Health Hackathon · Stage V2 baseline
Based strictly on the established reasoning: cold-start split (1A/1B),
Stage 2 input bridge, Bayesian prior-odds recalibration, T1 on-device /
T2-T3 edge-gateway boundary, zero-knowledge KPI tracking.

=====================================================================
DELIVERABLE 1 — UPGRADED MASTER BLUEPRINT (EXECUTIVE VISION)
=====================================================================

NAFAS VITALITY
"Stop asking men to walk into the lab. Start with the lab results they already have."
(Nafas = breath. The name is the promise: make the hardest preventive-health
conversation in male medicine easier to breathe through.)

THE WALL
Male factor contributes to roughly half of all infertility cases, and first-line
male workup still begins with a clinic visit and a semen analysis. That wall is
the commercial dead end of this market: men don't walk in, don't sample, don't
come back. Every digital-health platform that starts at the wall dies at the
wall. Nafas Vitality does not start at the wall. It starts behind it — with the
routine metabolic labs (IFHAS) most men already carry in their wallet.

THE FIX: THREE MATHEMATICALLY CALIBRATED GATES

GATE 1 — STAGE 1A · PASSIVE METABOLIC RADAR
- Input: a routine IFHAS lab the user already has (OCR'd on-device) plus a
  5-minute lifestyle questionnaire.
- Engine: metabolic risk model running in WASM, fully on the phone.
- Output: a risk tier, and — for above-threshold cohorts — a home
  6-hormone blood-spot voucher.
- Why it is zero-friction: it asks only for data that already exists. The
  single new action is tapping "accept home kit."
- Why it is calibrated: the trigger threshold is set so the voucher-eligible
  cohort carries prior odds of hormonal abnormality at least Kx the UAE
  baseline rate. The kit is economically justified by expected referral
  value before a single kit ships.

GATE 2 — STAGE 1B · TOHO 6-HORMONE ENGINE
- Input: the home blood-spot 6-hormone panel, fulfilled by phlebotomy
  partners and bridged to us via FHIR.
- Engine: the Toho clinic-baseline model, recalibrated with a Bayesian
  prior-odds logit offset:
    p_screen = sigmoid( logit( p_toho ) + ln( odds_UAE_general / odds_toho_clinic ) )
- Output: a calibrated probability with a known operating point — not a
  binary "abnormal." Healthy men get a clear, not a scare. That is the
  difference between a product men share with their partners and a product
  they delete.

GATE 3 — STAGE 2 · SEED-ML DRIFT BRIDGE
- No forced semen analysis. Reproductive drift is triangulated through three
  user-chosen channels:
  (a) In-silico projection — age + metabolic + hormonal trajectories from
      data we already hold;
  (b) OCR upload of a prior borderline clinic lab — most men have a stale
      result somewhere;
  (c) T2-consented At-Home Dual-Kit — the strongest signal, and genuinely
      optional.
- The model degrades gracefully: in-silico alone keeps the funnel alive even
  if the user does nothing. The funnel never dead-ends.

THE COLD-START PARADOX, SOLVED
Every screening product dies on the same question: how do you get the data
needed to decide whether the user needs the product? Stage 1A never asks for
data that doesn't exist. Stage 1B's data is earned — the user receives the
voucher as a reward for passing Gate 1, so the blood draw feels like a
benefit, not a cost. Stage 2's data is multi-channel and optional, so
non-engagement is a down-grade, not a dead end.

TRUST AS A MOAT
- T1 consent: Stage 1 runs entirely on-device (WASM) under a 30-day TTL.
  We can prove to the user, cryptographically, that nothing left the phone.
- T2/T3 consent: only then does the ADHICS V2 Edge Gateway activate —
  stripping PII into the Secret Identity Vault and forwarding only
  de-identified vectors to the Restricted ML Cloud.
- Zero-knowledge KPI: 30-day referral completion is tracked via Blind HMAC
  QR vouchers that partner clinics scan to trigger an anonymous webhook.
  We count completed referrals without ever learning who completed them.
- Consequence: ADHICS V2 compliance is not a checkbox — it is the sales
  argument to insurers, employer programs, and clinic partners who cannot
  carry PII risk, and to men burned by data stories.

THE COMMERCIAL ENGINE
- B2B2C: sold to insurers and employer wellness programs as a low-cost
  pre-screening layer. Gate 1 filters out most low-risk men before they
  ever see a specialist — the buyer pays for reduced specialist load, not
  for tests.
- Revenue stack: program fee per screened member · home-kit fulfillment
  margin · per-completed-referral fee from partner clinics · risk-engine
  API licensing to other programs.
- The voucher is the unit of account: every voucher is a measurable funnel
  step, and the blind KPI proves funnel health to buyers without a single
  identity exposed. The compliance story and the commercial story are the
  same story.

PROOF METRICS (DEFENSIBLE IN WEEK 1)
1. Gate-1 pass rate — vouchers issued per screened member.
2. Voucher redemption — kits shipped vs labs completed.
3. Calibration — Brier score of the 1B engine against partner-clinic
   outcomes (the logit offset is falsifiable).
4. 30-day referral completion — blind, zero-knowledge, auditable without
   touching a single identity.

POSITIONING LINE
"We don't ask men to walk into the lab. We ask the lab data they already
have to talk to a model that knows its own priors."

=====================================================================
DELIVERABLE 2 — END-TO-END DATA FLOW & COMPLIANCE MAP
=====================================================================

LEGEND
  ON-DEVICE  user phone, WASM sandbox — T1 features never leave
  EDGE       ADHICS V2 Edge Gateway — the only place PII and de-identified
             data ever co-locate
  VAULT      Secret Identity Vault — encrypted, break-glass access,
             immutable audit trail
  CLOUD      Restricted ML Cloud — no PII, no PII-adjacent (schema-enforced)
  CLINIC     partner clinic scanner
  KPI        zero-knowledge KPI store — structurally unjoinable with the VAULT

THE FLOW

STEP 1 — ONBOARDING (T1)
  ON-DEVICE   User consents to T1. Session key created on device.
  Data        consent record, session key · TTL 30 days
  Compliance  T1 scope = on-device only. Stage 1A never touches the EDGE.

STEP 2 — STAGE 1A INTAKE (T1)
  ON-DEVICE   IFHAS lab PDF OCR'd in the WASM sandbox; image purged after
              parse. Lifestyle questionnaire answered locally.
  Data        metabolic risk vector (numeric features only)
  Compliance  No network egress. The raw PDF never leaves the device. (I1)

STEP 3 — STAGE 1A DECISION + HOME-KIT VOUCHER (T1 -> T2 BRIDGE)
  ON-DEVICE   WASM engine scores against the calibrated Gate-1 threshold.
              Accepting the home kit = granting T2 (scope: hormone_panel).
  EDGE        First and only T1-era edge call: mints the voucher.
              token = HMAC-SHA256( seed_home_kit, nonce | expiry | cohort_tag )
              Seed resides in the VAULT HSM; the user's phone receives a
              bearer QR.
  Compliance  The voucher is linkable only via the vault mapping; the
              phlebotomy partner never sees a name or ID — only a kit order.

STEP 4 — STAGE 1B HORMONAL PANEL (T2)
  PARTNER LAB Home draw, 6-hormone panel, results bridged FHIR -> EDGE.
              The user's phone is NOT in this path.
  EDGE        PII strip: name, Emirates ID, DOB, address, lab ID
              -> pseudonym = UUID5( tenant | emirates_id_hash | vault_salt )
  VAULT       Gateway writes identity_vault_payload (encrypted mapping +
              T2 consent-grant record). Break-glass access only.
  CLOUD       Gateway forwards restricted_ml_payload: stage=1B,
              model_route=toho_6hormone_engine, 6-hormone feature_vector,
              opaque_session (random handle — NOT the pseudonym),
              prior_offset_meta (UAE general-screening prior, offset applied).
              Vector is canonicalized, hashed, signed before forwarding. (I3)
  CLOUD       Toho engine returns a calibrated probability (score envelope
              only; no input echo).
  EDGE        Joins score to pseudonym; serves it to the app over an
              authenticated endpoint with 30-day TTL.
  Compliance  The Restricted Cloud never receives identity fields or any
              linkable identifier beyond the opaque session handle. (I2)

STEP 5 — STAGE 2 DRIFT BRIDGE (T2/T3)
  User selects a channel in-app; tier-gated:
  5a  In-silico        ON-DEVICE builds a projection vector from the 1A/1B
                       history the app still holds in TTL -> EDGE strip ->
                       CLOUD, stage=2_DRIFT, drift_channel=in_silico.
                       (The 1A vector itself is never re-sent — only its hash
                       and the 1B score.)
  5b  Prior-lab OCR    ON-DEVICE OCRs the old borderline lab; structured
                       parameters (never the image) -> EDGE strip -> CLOUD,
                       drift_channel=prior_lab_ocr.
  5c  At-Home Dual-Kit T2-consented kit (T3 at referral). Sample ->
                       PARTNER LAB -> FHIR -> EDGE strip -> CLOUD,
                       drift_channel=at_home_dual_kit.
  CLOUD   SEED-ML emits drift score + triage decision (monitor | refer).
  EDGE    If triage = refer: mints the referral voucher from
          hmac_voucher_seed:
          qr_token = HMAC-SHA256( seed_referral, nonce | expiry | cohort_tag )
          The token encodes nothing the KPI store can use to identify a user.

STEP 6 — REDEPTION + ZERO-KNOWLEDGE KPI
  ON-DEVICE   User presents the blind QR at the partner clinic.
  CLINIC      Scanner POSTs the qr_token to the redeem endpoint.
  EDGE        Validates HMAC + TTL + single-use; marks redeemed.
  KPI         Edge fires the anonymous webhook:
              { event: referral_completed, cohort_tag, issued_at, redeemed_at }
              No pseudonym, no identity, no correlation to any prior vector.
  CLINIC      Receives only { status: valid_referral }; the patient
              self-identifies through the clinic's normal workflow.
  KPI         30-day referral completion = redemptions where
              redeemed_at - issued_at <= 30 days. Countable, auditable,
              and unjoinable with the vault by construction. (I4)

PER-ELEMENT COMPLIANCE TABLE

element                 consent  origin             transform              destination         TTL
----------------------  -------  -----------------  ---------------------  ------------------  ---------
IFHAS lab image         T1       phone camera       OCR -> vector, purge   on-device only      30d
metabolic vector        T1       on-device          —                      on-device only      30d
home-kit voucher        T2       edge HSM seed      HMAC mint              phone + lab partner 30d
PII (name/eID/dob)      T2       partner lab FHIR   edge strip             VAULT (encrypted)   90d*
pseudonym               T2       edge               UUID5 derivation       VAULT + edge join   90d*
6-hormone vector        T2       partner lab FHIR   strip + canonicalize   CLOUD (signed)      30d
opaque session          T2       edge               random handle          CLOUD model svc     per-session
1B calibrated score     T2       CLOUD              score envelope         edge -> app         30d
drift vectors (a/b/c)   T2/T3    phone / lab        strip + canonicalize   CLOUD (signed)      30d
referral QR (blind)     T3       edge HSM seed      HMAC blind mint        phone -> clinic     30d
redemption event        —        edge               anonymous webhook      KPI store (no join) count-only

* Vault retention is set by the ADHICS V2 data-residency policy; break-glass
  access is logged to the immutable audit trail.

AUDIT INVARIANTS (WHAT WE CLAIM ON STAGE)
I1  No T1 feature ever crosses a network boundary. (Schema rejects
    tier=T1 envelopes at the edge, so the boundary is structural.)
I2  The Restricted Cloud contains no PII or PII-adjacent field. (Closed
    schema + runtime value linter.)
I3  Every cloud-bound vector is canonicalized, hashed, and signed before
    forwarding. (Audit ledger.)
I4  The KPI store cannot be joined to the vault. (No shared key space —
    zero-knowledge by construction.)

=====================================================================
DELIVERABLE 3 — UPDATED FASTAPI / JSON SCHEMA
=====================================================================

FORWARDING MATRIX (THE ENTIRE COMPLIANCE STORY IN ONE TABLE)

section                     forwards to             never reaches
--------------------------  ----------------------  ----------------------------
identity_vault_payload      VAULT (encrypted)       CLOUD, KPI, any app response
hmac_voucher (incl. seed)   VAULT HSM keystore      CLOUD, KPI, app responses
restricted_ml_payload       CLOUD (canonical+signed)  VAULT, KPI

The schema enforces the matrix structurally: additionalProperties:false at
every level (closed world), tier/stage conditions in allOf, and a runtime
value linter in the gateway for identity-shaped values (I2).

JSON SCHEMA — edge-gateway-envelope-2026.11.0.json (draft 2020-12)

  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nafas.ae/adhics-v2/edge-gateway-envelope/2026.11.0",
    "title": "NafasVitality.EdgeGatewayEnvelope",
    "description": "ADHICS V2 Edge Gateway contract. Three mutually exclusive sections: identity_vault_payload (vault-only), restricted_ml_payload (cloud-only), hmac_voucher (vault HSM-only). T1 envelopes are structurally invalid here by design (invariant I1).",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schema_version", "correlation_id", "received_at",
      "consent_tier", "stage", "identity_vault_payload"
    ],
    "properties": {
      "schema_version": { "const": "2026.11.0" },
      "correlation_id": {
        "type": "string",
        "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
      },
      "received_at": { "type": "string", "format": "date-time" },
      "consent_tier": { "enum": ["T1", "T2", "T3"] },
      "stage": {
        "enum": ["1A_VOUCHER", "1B", "2_DRIFT", "2_REFERRAL"],
        "description": "Stage 1A itself never produces an envelope (on-device). 1A_VOUCHER exists only to mint the home-kit voucher after T2 consent."
      },
      "identity_vault_payload": {
        "description": "Written to the Secret Identity Vault only. Never forwarded to the Restricted ML Cloud.",
        "type": "object",
        "additionalProperties": false,
        "required": ["pseudonym", "identity_refs", "vault_action", "consent_grant"],
        "properties": {
          "pseudonym": {
            "type": "string",
            "pattern": "^pseud-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            "description": "UUID5(tenant | emirates_id_hash | vault_salt)"
          },
          "identity_refs": {
            "type": "object",
            "additionalProperties": false,
            "required": ["emirates_id_hash"],
            "properties": {
              "emirates_id_hash": {
                "type": "string",
                "minLength": 64,
                "maxLength": 64,
                "description": "SHA-256(emirates_id | tenant_salt), hex. The plaintext eID never appears anywhere."
              },
              "legal_name_enc": {
                "type": "string",
                "description": "GCM-encrypted blob under the vault master key. No plaintext PII at rest."
              },
              "lab_origin": {
                "type": "string",
                "description": "Partner-lab identifier (not patient PII)."
              }
            }
          },
          "vault_action": { "enum": ["upsert", "map_only"] },
          "consent_grant": {
            "type": "object",
            "additionalProperties": false,
            "required": ["tier", "granted_at", "granted_via", "scope"],
            "properties": {
              "tier": { "enum": ["T1", "T2", "T3"] },
              "granted_at": { "type": "string", "format": "date-time" },
              "granted_via": { "enum": ["in_app", "phlebotomy_kiosk"] },
              "scope": {
                "type": "array",
                "minItems": 1,
                "items": {
                  "enum": [
                    "hormone_panel", "drift_in_silico",
                    "drift_prior_lab_ocr", "drift_at_home_dual_kit", "referral"
                  ]
                }
              }
            }
          }
        }
      },
      "restricted_ml_payload": {
        "description": "Forwarded to the Restricted ML Cloud only. Structurally and lint-isolated from identity_vault_payload (invariant I2).",
        "type": "object",
        "additionalProperties": false,
        "required": ["stage", "model_route", "opaque_session", "feature_vector"],
        "properties": {
          "stage": { "enum": ["1B", "2_DRIFT", "2_REFERRAL"] },
          "model_route": { "enum": ["toho_6hormone_engine", "seed_ml_drift"] },
          "opaque_session": {
            "type": "string",
            "minLength": 32,
            "description": "Gateway-minted random handle. The cloud never sees the pseudonym or any identity field."
          },
          "prior_offset_meta": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "population_prior": { "const": "uae_general_screening" },
              "baseline_prior": { "const": "toho_clinic" },
              "logit_offset_applied": { "type": "boolean" }
            }
          },
          "feature_vector": {
            "oneOf": [
              { "$ref": "#/$defs/hormone_vector" },
              { "$ref": "#/$defs/drift_vector" }
            ]
          }
        }
      },
      "hmac_voucher": {
        "description": "Written to the vault HSM keystore only. The seed never appears in any cloud-bound or KPI-bound serialization.",
        "type": "object",
        "additionalProperties": false,
        "required": ["voucher_type", "hmac_voucher_seed", "seed_origin", "voucher_ttl_days", "cohort_tag"],
        "properties": {
          "voucher_type": { "enum": ["home_blood_spot", "clinic_referral"] },
          "hmac_voucher_seed": {
            "type": "string",
            "minLength": 43,
            "description": "Base64(32 bytes). Blind mint: token = HMAC-SHA256(seed, nonce | issued | expiry | cohort_tag). The KPI side can verify redemptions without mapping any token to a user."
          },
          "seed_origin": { "const": "hsm" },
          "voucher_ttl_days": { "type": "integer", "minimum": 1, "maximum": 90, "default": 30 },
          "cohort_tag": {
            "type": "string",
            "description": "Cohort label. The only key shared with the KPI store, and the KPI store is structurally unjoinable to the vault (invariant I4)."
          }
        }
      }
    },
    "$defs": {
      "hormone_vector": {
        "type": "object",
        "additionalProperties": false,
        "required": ["panel", "total_testosterone", "free_testosterone", "fsh", "lh", "estradiol", "prolactin"],
        "properties": {
          "panel": { "const": "toho_6hormone" },
          "total_testosterone": { "type": "number", "exclusiveMinimum": 0, "description": "nmol/L" },
          "free_testosterone": { "type": "number", "exclusiveMinimum": 0, "description": "pmol/L" },
          "fsh": { "type": "number", "exclusiveMinimum": 0, "description": "IU/L" },
          "lh": { "type": "number", "exclusiveMinimum": 0, "description": "IU/L" },
          "estradiol": { "type": "number", "exclusiveMinimum": 0, "description": "pmol/L" },
          "prolactin": { "type": "number", "exclusiveMinimum": 0, "description": "mIU/L" }
        }
      },
      "drift_vector": {
        "type": "object",
        "additionalProperties": false,
        "required": ["drift_channel", "drift_features"],
        "properties": {
          "drift_channel": { "enum": ["in_silico", "prior_lab_ocr", "at_home_dual_kit"] },
          "drift_features": {
            "oneOf": [
              {
                "type": "object",
                "additionalProperties": false,
                "required": ["age_delta_days", "hormone_score_1b", "metabolic_vector_hash"],
                "properties": {
                  "age_delta_days": { "type": "integer", "minimum": 0 },
                  "hormone_score_1b": {
                    "type": "number", "minimum": 0, "maximum": 1,
                    "description": "Calibrated 1B probability (not raw hormone values)"
                  },
                  "metabolic_vector_hash": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$",
                    "description": "SHA-256 of the on-device 1A vector; the vector itself is never re-sent."
                  }
                }
              },
              {
                "type": "object",
                "additionalProperties": false,
                "required": ["source_lab_date", "semen_parameters"],
                "properties": {
                  "source_lab_date": { "type": "string", "format": "date" },
                  "source_is_borderline": { "type": "boolean" },
                  "semen_parameters": { "$ref": "#/$defs/semen_parameter_set" }
                }
              }
            ]
          }
        }
      },
      "semen_parameter_set": {
        "type": "object",
        "additionalProperties": false,
        "minProperties": 1,
        "description": "Prior-lab OCR sends the full available set; the At-Home Dual-Kit sends the 2-parameter subset (count + motility).",
        "properties": {
          "concentration": { "type": "number", "exclusiveMinimum": 0, "description": "10^6/mL" },
          "total_count": { "type": "number", "exclusiveMinimum": 0, "description": "10^6" },
          "progressive_motility": { "type": "number", "minimum": 0, "maximum": 1 },
          "morphology_normal_forms": { "type": "number", "minimum": 0, "maximum": 1 },
          "volume_ml": { "type": "number", "exclusiveMinimum": 0 }
        }
      }
    },
    "allOf": [
      {
        "if": { "properties": { "consent_tier": { "const": "T1" } } },
        "then": { "not": { "type": "object" } },
        "description": "I1: T1 never reaches the edge. Tier=T1 envelopes are structurally invalid."
      },
      {
        "if": { "properties": { "stage": { "const": "1A_VOUCHER" } } },
        "then": {
          "properties": { "consent_tier": { "const": "T2" } },
          "not": { "required": ["restricted_ml_payload"] }
        }
      },
      {
        "if": { "properties": { "stage": { "const": "1B" } } },
        "then": { "required": ["restricted_ml_payload"] }
      },
      {
        "if": { "properties": { "consent_tier": { "const": "T2" } } },
        "then": { "properties": { "stage": { "enum": ["1A_VOUCHER", "1B", "2_DRIFT"] } } }
      },
      {
        "if": { "properties": { "stage": { "const": "2_REFERRAL" } } },
        "then": {
          "properties": { "consent_tier": { "const": "T3" } },
          "required": ["hmac_voucher"]
        }
      }
    ]
  }

SAMPLE INSTANCE — Stage 1B (hormonal panel landing from the FHIR bridge)

  {
    "schema_version": "2026.11.0",
    "correlation_id": "3f2b7c1e-4a6d-4e8f-9b0c-1d2e3f4a5b6c",
    "received_at": "2026-11-16T09:41:00Z",
    "consent_tier": "T2",
    "stage": "1B",
    "identity_vault_payload": {
      "pseudonym": "pseud-9c1d4a2e-7b3f-4a61-8c02-e1f4a9b7c3d5",
      "identity_refs": {
        "emirates_id_hash": "5f1c9e0a7b2d4c8f3e6a1d0b9c8f7e6a5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a",
        "legal_name_enc": "enc:gcm:v1:8f3a...91c2",
        "lab_origin": "partner_lab_homephlebo_ae_07"
      },
      "vault_action": "upsert",
      "consent_grant": {
        "tier": "T2",
        "granted_at": "2026-11-14T18:22:00Z",
        "granted_via": "phlebotomy_kiosk",
        "scope": ["hormone_panel"]
      }
    },
    "restricted_ml_payload": {
      "stage": "1B",
      "model_route": "toho_6hormone_engine",
      "opaque_session": "oss_7f1e2d3c4b5a69788899aabbccddeeff01",
      "prior_offset_meta": {
        "population_prior": "uae_general_screening",
        "baseline_prior": "toho_clinic",
        "logit_offset_applied": true
      },
      "feature_vector": {
        "panel": "toho_6hormone",
        "total_testosterone": 14.2,
        "free_testosterone": 410.0,
        "fsh": 6.8,
        "lh": 4.1,
        "estradiol": 128.0,
        "prolactin": 182.0
      }
    },
    "hmac_voucher": {
      "voucher_type": "clinic_referral",
      "hmac_voucher_seed": "g7KqXw2mP9vL5bN4cR8tY1aZ3eF6hJ0kD7sU2wV5xZQ=",
      "seed_origin": "hsm",
      "voucher_ttl_days": 30,
      "cohort_tag": "uae_2026Q4_stage2_referral"
    }
  }

FASTAPI — edge_gateway.py

  # edge_gateway.py — Nafas Vitality · ADHICS V2 Edge Gateway · v2026.11.0
  #
  # Invariants enforced at this boundary (see Deliverable 2):
  #   I1  T1 never reaches the edge — schema rejects tier=T1 envelopes.
  #   I2  Vault first — identity_vault_payload is written before any external call.
  #   I3  restricted_ml_payload is canonicalized + signed before forwarding; no identity material.
  #   I4  KPI webhook shares no field with the vault (zero-knowledge by construction).

  import hashlib, hmac as _hmac, json, re, uuid
  from datetime import datetime, timedelta, timezone
  from enum import Enum
  from typing import Literal, Optional

  import jsonschema
  from fastapi import FastAPI, Header, HTTPException
  from pydantic import BaseModel, Field, field_validator

  SCHEMA_VERSION = "2026.11.0"
  EDGE_SCHEMA = json.loads(open("schemas/edge-gateway-envelope-2026.11.0.json").read())
  FORBIDDEN_VALUE_RE = re.compile(r"\b78[45]\d{8}\b|\b\+?\d{9,15}\b")  # eID / phone shapes
  now = lambda: datetime.now(timezone.utc)


  class ConsentTier(str, Enum):
      T1 = "T1"; T2 = "T2"; T3 = "T3"


  class Stage(str, Enum):
      VOUCHER = "1A_VOUCHER"
      S1B = "1B"
      DRIFT = "2_DRIFT"
      REFERRAL = "2_REFERRAL"


  # ---- identity side: vault-bound, never cloud -----------------------------

  class IdentityRefs(BaseModel):
      model_config = {"extra": "forbid"}
      emirates_id_hash: str = Field(pattern=r"^[0-9a-f]{64}$")  # sha256(eid | tenant_salt)
      legal_name_enc: Optional[str] = Field(
          default=None,
          description="GCM blob under the vault master key — no plaintext PII at rest")
      lab_origin: Optional[str] = None


  class ConsentGrant(BaseModel):
      model_config = {"extra": "forbid"}
      tier: ConsentTier
      granted_at: datetime
      granted_via: Literal["in_app", "phlebotomy_kiosk"]
      scope: list[str] = Field(min_length=1)


  class IdentityVaultPayload(BaseModel):
      model_config = {"extra": "forbid"}
      pseudonym: str = Field(
          pattern=r"^pseud-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
      identity_refs: IdentityRefs
      vault_action: Literal["upsert", "map_only"]
      consent_grant: ConsentGrant


  # ---- ML side: cloud-bound, never vault ------------------------------------

  class HormoneVector(BaseModel):
      model_config = {"extra": "forbid"}
      panel: Literal["toho_6hormone"]
      total_testosterone: float = Field(gt=0, description="nmol/L")
      free_testosterone: float = Field(gt=0, description="pmol/L")
      fsh: float = Field(gt=0)
      lh: float = Field(gt=0)
      estradiol: float = Field(gt=0)
      prolactin: float = Field(gt=0)


  class DriftVector(BaseModel):
      model_config = {"extra": "forbid"}
      drift_channel: Literal["in_silico", "prior_lab_ocr", "at_home_dual_kit"]
      drift_features: dict  # shape enforced by the JSON Schema oneOf


  class RestrictedMLPayload(BaseModel):
      model_config = {"extra": "forbid"}
      stage: Literal["1B", "2_DRIFT", "2_REFERRAL"]
      model_route: Literal["toho_6hormone_engine", "seed_ml_drift"]
      opaque_session: str = Field(
          min_length=32,
          description="Gateway-minted random handle — cloud never sees the pseudonym")
      prior_offset_meta: Optional[dict] = None
      feature_vector: Optional[HormoneVector | DriftVector] = None


  class HmacVoucher(BaseModel):
      model_config = {"extra": "forbid"}
      voucher_type: Literal["home_blood_spot", "clinic_referral"]
      hmac_voucher_seed: str = Field(
          min_length=43,
          description="Base64(32B). Vault HSM hop only — never serialized to cloud or KPI.")
      seed_origin: Literal["hsm"]
      voucher_ttl_days: int = Field(default=30, ge=1, le=90)
      cohort_tag: str


  class EdgeGatewayEnvelope(BaseModel):
      model_config = {"extra": "forbid"}
      schema_version: Literal["2026.11.0"]
      correlation_id: uuid.UUID
      received_at: datetime
      consent_tier: ConsentTier
      stage: Stage
      identity_vault_payload: IdentityVaultPayload
      restricted_ml_payload: Optional[RestrictedMLPayload] = None
      hmac_voucher: Optional[HmacVoucher] = None

      @field_validator("restricted_ml_payload")
      @classmethod
      def _no_identity_leak(cls, v):
          # I2 second layer: value-shape linter on top of the closed schema
          if v is not None:
              blob = v.model_dump_json()
              if "pseud-" in blob or FORBIDDEN_VALUE_RE.search(blob):
                  raise ValueError("identity material inside restricted_ml_payload — rejected")
          return v


  # Adapters (internals out of contract):
  vault = SecretIdentityVault()      # encrypted at rest, break-glass, immutable audit
  keystore = HSMKeystore()           # holds hmac_voucher_seed; never serialized outward
  cloud = RestrictedCloudClient()    # mTLS forwarder, signature-only API
  kpi = KPIWebhookClient()           # anonymous store — no join key to the vault (I4)
  result_store = CloudResultStore()


  def _canonical(obj) -> bytes:
      return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()


  def _mint(v: HmacVoucher) -> dict:
      seed = keystore.material(v.hmac_voucher_seed)   # HSM-resident material
      nonce = uuid.uuid4().hex
      issued = now()
      exp = issued + timedelta(days=v.voucher_ttl_days)
      msg = f"{v.voucher_type}|{nonce}|{issued.isoformat()}|{exp.isoformat()}|{v.cohort_tag}"
      return {
          "qr_token": _hmac.new(seed, msg.encode(), hashlib.sha256).hexdigest(),
          "issued_at": issued.isoformat(),
          "expires_at": exp.isoformat(),
          "cohort_tag": v.cohort_tag,
          "redemptions": 1,
      }


  app = FastAPI(title="Nafas ADHICS V2 Edge Gateway", version=SCHEMA_VERSION)


  @app.post("/v1/edge/ingest")
  async def ingest(env: EdgeGatewayEnvelope):
      # Closed world: additionalProperties:false + tier/stage conditions (I1)
      jsonschema.validate(env.model_dump(mode="json"), EDGE_SCHEMA)

      # I2: vault first — mapping exists before any external call
      vault.write(env.identity_vault_payload)

      voucher = _mint(env.hmac_voucher) if env.hmac_voucher else None

      # I3: only after vault ack does the de-identified vector get
      # canonicalized, hashed, signed, and forwarded
      if env.restricted_ml_payload is not None:
          blob = _canonical(env.restricted_ml_payload.model_dump(mode="json"))
          sig = _hmac.new(cloud.key(), blob, hashlib.sha256).hexdigest()
          cloud.submit(blob, signature=sig)

      return {"correlation_id": str(env.correlation_id), "vault_ack": True, "voucher": voucher}


  @app.post("/v1/voucher/redeem")
  async def redeem(qr_token: str, x_clinic_id: str = Header(...)):
      v = keystore.verify_and_consume(qr_token, clinic_id=x_clinic_id)  # HMAC + single-use + TTL
      if v is None:
          raise HTTPException(404, "invalid, expired, or already-redeemed voucher")
      # I4: KPI event shares no field with the vault — countable, not joinable
      kpi.post({
          "event": "referral_completed",
          "cohort_tag": v["cohort_tag"],
          "issued_at": v["issued_at"],
          "redeemed_at": now().isoformat(),
      })
      return {"status": "valid_referral", "patient_action": "self_identify_at_clinic"}


  @app.get("/v1/results/{pseudonym}")
  async def fetch_result(pseudonym: str, x_app_token: str = Header(...)):
      vault.session_check(pseudonym, x_app_token, ttl_days=30)  # 30-day TTL enforced here
      return result_store.get(pseudonym)

NOTE ON ADAPTERS: SecretIdentityVault, HSMKeystore, RestrictedCloudClient,
KPIWebhookClient, and CloudResultStore are adapters; their internals are out
of contract for the envelope. Invariants I1-I4 hold at the envelope boundary
shown above, which is exactly what an ADHICS V2 audit inspects.
