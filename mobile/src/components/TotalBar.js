// Estimated total, pinned to the bottom, with one-stop trip comparisons.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { estimate, oneStopTrips, money, miles, chainName } from '../lib/shared';
import { useAppData } from '../state/AppData';
import { useTheme, font } from '../theme';
import { ChainDot } from './bits';

export default function TotalBar({ analyses }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { list, stores, here } = useAppData();
  const [showTrips, setShowTrips] = useState(false);
  if (!list.length) return null;

  const est = estimate(analyses, list);
  const missing = est.count - est.priced;
  const note = missing
    ? `Lowest price for ${est.priced} of ${est.count} items. ${missing} ${missing > 1 ? "don't have" : "doesn't have"} a listed price yet.`
    : est.count === 1 ? 'Lowest price nearby.' : `Lowest price for all ${est.count} items, mixing stores.`;
  // One-stop trips are per chain; friend-added stores are each their own, so they're left out.
  const trips = oneStopTrips(analyses, list).filter((x) => x.chain !== 'other');

  return (
    <View style={[styles.bar, { backgroundColor: t.ink, paddingBottom: 12 }]}>
      <View style={styles.main}>
        <Text style={[styles.label, { color: t.bg }]}>Estimated total</Text>
        <Text style={[styles.amount, { color: t.bg }]}>{money(est.total)}</Text>
      </View>
      <Text style={[styles.note, { color: t.bg }]}>{note}</Text>
      <Pressable onPress={() => setShowTrips(!showTrips)} accessibilityRole="button" accessibilityState={{ expanded: showTrips }}>
        <Text style={[styles.toggle, { color: t.tag }]}>{showTrips ? 'Hide one-stop trips' : 'Compare one-stop trips'}</Text>
      </Pressable>
      {showTrips && (trips.length ? trips.map((x) => {
        const s = stores.filter((st) => st.chain === x.chain).map((st) => ({ st, d: miles(here, st) })).sort((p, q) => p.d - q.d)[0];
        return (
          <View key={x.chain} style={[styles.trip, { borderColor: 'rgba(255,255,255,0.2)' }]}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ChainDot chain={x.chain} />
                <Text style={[styles.tripName, { color: t.bg }]}>Only {chainName(x.chain, s?.st.banner)}</Text>
              </View>
              <Text style={[styles.tripSub, { color: t.bg }]}>{x.covered} of {est.count} items{s ? ` · ${s.st.name}, ${s.d.toFixed(1)} mi` : ''}</Text>
            </View>
            <Text style={[styles.tripAmt, { color: t.bg }]}>{money(x.total)}</Text>
          </View>
        );
      }) : <Text style={[styles.tripSub, { color: t.bg }]}>No single store has priced matches yet.</Text>)}
      <View style={{ height: Math.max(0, insets.bottom - 20) }} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingTop: 12 },
  main: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { fontFamily: font.body, fontSize: 15, opacity: 0.85 },
  amount: { fontFamily: font.numBold, fontSize: 40 },
  note: { fontFamily: font.body, fontSize: 14, opacity: 0.8 },
  toggle: { fontFamily: font.bodyMedium, fontSize: 14, paddingTop: 8, paddingBottom: 2 },
  trip: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, paddingVertical: 8 },
  tripName: { fontFamily: font.body, fontSize: 15 },
  tripSub: { fontFamily: font.body, fontSize: 13, opacity: 0.75 },
  tripAmt: { fontFamily: font.numBold, fontSize: 22 },
});
