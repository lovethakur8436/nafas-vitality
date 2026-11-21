/**
 * Nafas Vitality — root component (Gate 1A scaffold).
 *
 * Step 1 of docs/gate1a_implementation_plan.md: placeholder screen only.
 * Replaced by the state-driven screen router in Step 14.
 *
 * NOTE: RN 0.88 deprecates core `SafeAreaView` — screens in Steps 10–13 use
 * plain `View` (+ padding) to stay dependency-free at scaffold stage.
 */
import React from 'react';
import {StatusBar, StyleSheet, Text, View} from 'react-native';

export default function App(): React.JSX.Element {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <View style={styles.card}>
        <Text style={styles.title}>Nafas Vitality</Text>
        <Text style={styles.subtitle}>
          Gate 1A · Passive Metabolic Radar (scaffold)
        </Text>
        <Text style={styles.hint}>
          100% on-device. Next: domain types + IFHAS ontology.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0B1220', justifyContent: 'center', padding: 24},
  card: {
    backgroundColor: '#111C2E',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  title: {color: '#FFFFFF', fontSize: 24, fontWeight: '700'},
  subtitle: {color: '#8FB3FF', fontSize: 15, marginTop: 8},
  hint: {color: '#94A3B8', fontSize: 13, marginTop: 12},
});
