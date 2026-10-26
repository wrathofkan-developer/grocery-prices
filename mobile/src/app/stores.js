// Stores near you, grouped by chain, with how fresh each chain's prices are.
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { miles, chainName, ago, rangeLabel } from '../lib/shared';
import { useAppData, AD_CHAINS } from '../state/AppData';
import { useTheme, font } from '../theme';
import Header from '../components/Header';
import { ChainDot } from '../components/bits';

export default function Stores() {
  const t = useTheme();
  const { stores, here, status, radius } = useAppData();

  const groups = new Map();
  for (const s of stores) {
    const key = s.chain === 'kroger' || s.chain === 'other' ? `${s.chain}:${s.banner || s.name}` : s.chain;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ s, d: miles(here, s) });
  }
  const sorted = [...groups.values()].map((l) => l.sort((a, b) => a.d - b.d)).sort((a, b) => a[0].d - b[0].d);

  const freshness = (chain) => {
    if (!AD_CHAINS.includes(chain)) {
      return chain === 'kroger' ? 'Live prices from Kroger, checked when you add an item' : 'Added by a friend';
    }
    const st = status[chain];
    if (!st) return 'Not fetched yet';
    let line = `Updated ${ago(st.at)}`;
    if (st.ads?.length) line += ` · ${st.ads.map((a) => rangeLabel(a.valid_from, a.valid_to)).join(', ')}`;
    return line;
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.bg }]} edges={['top']}>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        {sorted.length === 0 && <Text style={[styles.meta, { color: t.muted }]}>No stores we know of within {radius} miles.</Text>}
        {sorted.map((list) => {
          const s0 = list[0].s;
          const err = AD_CHAINS.includes(s0.chain) ? status[s0.chain]?.last_error : null;
          return (
            <View key={`${s0.chain}-${s0.banner || ''}`} style={styles.group}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ChainDot chain={s0.chain} />
                <Text style={[styles.groupTitle, { color: t.ink }]}>{chainName(s0.chain, s0.banner)}</Text>
              </View>
              <Text style={[styles.meta, { color: t.muted }]}>{freshness(s0.chain)}</Text>
              {err && <Text style={[styles.meta, { color: t.warn }]}>Last update failed {ago(err.at)}: {err.error}</Text>}
              {list.map(({ s, d }) => (
                <View key={s.id} style={[styles.store, { borderColor: t.line }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.name, { color: t.ink }]}>{s.name}</Text>
                    {s.address ? <Text style={[styles.meta, { color: t.muted }]}>{s.address}</Text> : null}
                    {s.note ? <Text style={[styles.meta, { color: t.muted }]}>{s.note}</Text> : null}
                  </View>
                  <Text style={[styles.dist, { color: t.ink }]}>{d.toFixed(1)} mi</Text>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  group: { marginTop: 18 },
  groupTitle: { fontFamily: font.num, fontSize: 21 },
  store: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingVertical: 12, gap: 12 },
  name: { fontFamily: font.bodyBold, fontSize: 16 },
  meta: { fontFamily: font.body, fontSize: 14 },
  dist: { fontFamily: font.num, fontSize: 19 },
});
