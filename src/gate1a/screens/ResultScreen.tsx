/**
 * Gate 1A — ResultScreen: tier + SHAP top-3 + voucher CTA (Step 13).
 *
 * Flow:
 *   - SCORING ⇒ "Scoring…" spinner state; an effect runs the on-device
 *     engine (`engine.score(vector)`) and calls `scoreComplete` — the
 *     machine reaches RESULT on the same tick (the engine is synchronous,
 *     <20 ms budget, V3 constraint 8).
 *   - RESULT ⇒ tier banner + screening-estimate disclaimer + top-3
 *     plain-language factors (explain.ts).
 *     - LOW ⇒ "no action needed" path: the result is persisted with the
 *       30-day TTL so the TTL sweep auto-purges it (V3 constraint 4);
 *       no kit offer, no voucher.
 *     - ELEVATED / HIGH ⇒ "Accept home kit" ⇒ `mintVoucher` (one fresh
 *       32-byte CSPRNG draw) + `grantT2` (T2 consent, scope
 *       `hormone_panel`) ⇒ `acceptKit` ⇒ bearer code + expiry are shown
 *       and the voucher is persisted (30-day TTL stamp). "Decline" keeps
 *       the result and mints nothing.
 *   - "Delete all" (one tap) ⇒ storage wipe + store → IDLE (V3
 *     constraint 4: total, immediate, local).
 *
 * RN 0.88 note: core SafeAreaView is deprecated — plain View + padding
 * (Steps 10–13 convention).
 *
 * @format
 */

import {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

import type {EncryptedStorage} from '../storage';
import type {T2ConsentRecord, Voucher} from '../types';
import type {Csprng} from '../voucher';
import {grantT2, mintVoucher} from '../voucher';
import {explainTopFactors} from '../engine/explain';
import type {InferenceEngine} from '../engine/InferenceEngine';
import {useGate1AStore} from '../store';
import {VOUCHER_TTL_MS} from '../constants';

/** Storage record ids (structured payloads only — never image bytes). */
const RESULT_RECORD_ID = 'gate1a-result';
const VOUCHER_RECORD_ID = 'gate1a-voucher';

export interface ResultScreenProps {
  /** On-device inference engine (MockMetabolicModel in scaffold/tests). */
  readonly engine: InferenceEngine;
  /** Encrypted on-device store (MockEncryptedStorage in headless tests). */
  readonly storage: EncryptedStorage;
  /** Fresh 32-byte CSPRNG draw per call — used exactly once per voucher. */
  readonly rng: Csprng;
}

/** Formats an epoch-ms timestamp as a compact local date for display. */
function formatDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function ResultScreen({
  engine,
  storage,
  rng,
}: ResultScreenProps): React.JSX.Element {
  const state = useGate1AStore(s => s.state);
  const result = useGate1AStore(s => s.result);
  const vector = useGate1AStore(s => s.vector);
  const voucher = useGate1AStore(s => s.voucher);

  const [consent, setConsent] = useState<T2ConsentRecord | null>(null);

  // SCORING → RESULT: run the engine exactly once per scoring session
  // (guards against double effects; the engine call is pure + sync).
  const scoredRef = useRef(false);
  useEffect(() => {
    if (state !== 'SCORING' || vector === null) {
      return;
    }
    if (!scoredRef.current) {
      scoredRef.current = true;
      const s = useGate1AStore.getState();
      s.scoreComplete(engine.score(vector));
    }
  }, [state, vector, engine]);

  // Persist the result once it exists (LOW ⇒ flagged for the 30-day
  // auto-purge by the default TTL; ELEVATED/HIGH ⇒ same, plus the kit
  // offer stays on screen).
  const persistedRef = useRef(false);
  useEffect(() => {
    if (result === null || persistedRef.current) {
      return;
    }
    persistedRef.current = true;
    void storage.save({id: RESULT_RECORD_ID, data: result});
  }, [result, storage]);

  if (state === 'SCORING') {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Scoring…</Text>
        <Text style={styles.hint}>
          Running your metabolic risk model on this phone. Nothing leaves
          the device.
        </Text>
      </View>
    );
  }

  if (result === null) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>No result yet</Text>
      </View>
    );
  }

  const {sentences} = explainTopFactors(result.shap);
  const eligible = result.tier !== 'LOW';

  const acceptKit = async (): Promise<void> => {
    const s = useGate1AStore.getState();
    if (s.state !== 'RESULT' || s.result === null || s.result.tier === 'LOW') {
      return;
    }
    // One fresh 32-byte draw per voucher; mintedAt = now, 30-day expiry.
    const v: Voucher = mintVoucher(rng, s.result.tier);
    const record = grantT2(v);
    s.acceptKit(v);
    setConsent(record);
    // V3 constraint 5: the bearer voucher is persisted on-device with a
    // TTL stamp; it is never uploaded (there is no network to upload to).
    await storage.save({
      id: VOUCHER_RECORD_ID,
      data: {voucher: v, consent: record},
      ttlMs: VOUCHER_TTL_MS,
    });
  };

  const deleteAll = async (): Promise<void> => {
    // V3 constraint 4: one tap ⇒ total local wipe ⇒ machine back to IDLE.
    await storage.deleteAll();
    useGate1AStore.getState().deleteAll();
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Your screening estimate</Text>
      <Text style={styles.tier}>{result.tier}</Text>
      <Text style={styles.hint}>
        Screening estimate only — not a diagnosis. Computed on this phone
        by model {result.modelVersion}.
      </Text>

      <Text style={styles.factorsHeading}>What drives this estimate</Text>
      {sentences.map((sentence, i) => (
        <Text key={i} style={styles.factor}>
          {i + 1}. {sentence}
        </Text>
      ))}

      {eligible && voucher === null && (
        <View style={styles.ctaRow}>
          <TouchableOpacity
            testID="result-accept"
            accessibilityRole="button"
            style={styles.button}
            onPress={() => void acceptKit()}>
            <Text style={styles.buttonText}>Accept home kit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="result-decline"
            accessibilityRole="button"
            style={styles.textButton}
            onPress={() => undefined}>
            <Text style={styles.textBtnText}>Decline — keep my result</Text>
          </TouchableOpacity>
        </View>
      )}

      {!eligible && (
        <Text style={styles.noAction}>
          No action needed. This result is stored only on this phone and
          is auto-purged after 30 days.
        </Text>
      )}

      {voucher !== null && (
        <View style={styles.voucherCard}>
          <Text style={styles.voucherTitle}>Home kit voucher</Text>
          <Text style={styles.voucherField}>
            Program: {voucher.programCode}
          </Text>
          <Text style={styles.voucherField}>
            Bearer code: {voucher.token}
          </Text>
          <Text style={styles.voucherField}>
            Expires: {formatDay(voucher.expiresAt)}
          </Text>
          {consent !== null && (
            <Text style={styles.voucherField}>
              T2 consent ({consent.scope}) granted {formatDay(consent.grantedAt)}
            </Text>
          )}
        </View>
      )}

      <TouchableOpacity
        testID="result-delete-all"
        accessibilityRole="button"
        style={styles.dangerButton}
        onPress={() => void deleteAll()}>
        <Text style={styles.buttonText}>Delete all</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, padding: 24},
  title: {fontSize: 22, fontWeight: '600', marginBottom: 8},
  tier: {fontSize: 30, fontWeight: '700', color: '#0B6E4F', marginBottom: 8},
  hint: {fontSize: 13, color: '#64748B', marginBottom: 16},
  factorsHeading: {fontSize: 16, fontWeight: '600', marginBottom: 8},
  factor: {fontSize: 14, color: '#334155', marginBottom: 6},
  noAction: {fontSize: 14, color: '#64748B', marginBottom: 16},
  ctaRow: {gap: 10, marginBottom: 16},
  button: {
    backgroundColor: '#0B6E4F',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 14,
  },
  buttonText: {color: '#FFFFFF', fontSize: 16, fontWeight: '600'},
  textButton: {alignItems: 'center', paddingVertical: 8},
  textBtnText: {fontSize: 14, color: '#475569'},
  voucherCard: {
    backgroundColor: '#111C2E',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  voucherTitle: {fontSize: 16, fontWeight: '600', color: '#FFFFFF', marginBottom: 8},
  voucherField: {fontSize: 13, color: '#94A3B8', marginBottom: 6},
  dangerButton: {
    backgroundColor: '#7F1D1D',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
});
