// This week's deals: sale items from every nearby store's ad, searchable.
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CHAINS, priceStatus, rangeLabel, dayLabel, tokens, matches, shortName } from '../lib/shared';
import { useAppData } from '../state/AppData';
import { useTheme, font } from '../theme';
import Header from '../components/Header';
import PriceTag from '../components/PriceTag';
import { ChainDot, ItemName } from '../components/bits';

export default function Deals() {
  const t = useTheme();
  const { items, labelFor, addItem } = useAppData();
  const [query, setQuery] = useState('');
  const [chain, setChain] = useState('all');
  const [added, setAdded] = useState({});

  const sale = useMemo(() => items.filter((it) => it.kind === 'sale'), [items]);
  const present = Object.keys(CHAINS).filter((k) => sale.some((it) => it.chain === k));
  const chipName = (k) => [...new Set(sale.filter((it) => it.chain === k).map(labelFor))].join(' / ') || CHAINS[k].name;

  const sections = useMemo(() => {
    const q = tokens(query);
    const shown = sale.filter((it) => (chain === 'all' || it.chain === chain) && (!q.length || matches(it, q)));
    const active = shown.filter((it) => priceStatus(it) === 'active');
    const upcoming = shown.filter((it) => priceStatus(it) === 'upcoming');
    const out = [];
    for (const c of Object.keys(CHAINS)) {
      const list = active.filter((i) => i.chain === c);
      if (!list.length) continue;
      const ads = [...new Map(list.filter((i) => i.ad_id).map((i) => [i.ad_id, i])).values()];
      const windows = ads.length ? ads.map((i) => `${i.ad_name || 'Ad'}: ${rangeLabel(i.valid_from, i.valid_to)}`).join('\n')
        : c === 'kroger' ? 'Sale prices for items on your list' : '';
      list.sort((a, b) => (a.price == null) - (b.price == null) || a.name.localeCompare(b.name));
      out.push({ key: c, chain: c, title: [...new Set(list.map(labelFor))].join(' / '), windows, data: list.slice(0, 150) });
    }
    if (upcoming.length) {
      const starts = [...new Set(upcoming.map((i) => i.valid_from))].sort();
      out.push({ key: 'soon', chain: null, title: 'Starting soon', windows: `Takes effect ${starts.map(dayLabel).join(', ')}. Posted early, not active yet.`, data: upcoming });
    }
    return out;
  }, [sale, query, chain, labelFor]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.bg }]} edges={['top']}>
      <Header />
      <View style={styles.filters}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search this week's ads"
          placeholderTextColor={t.muted}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[styles.input, { backgroundColor: t.surface, borderColor: t.line, color: t.ink }]}
          accessibilityLabel="Search deals"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {[['all', 'All stores'], ...present.map((k) => [k, chipName(k)])].map(([k, label]) => (
            <Pressable
              key={k}
              onPress={() => setChain(k)}
              style={[styles.chip, { borderColor: chain === k ? t.ink : t.line, backgroundColor: t.surface }]}
              accessibilityRole="button"
              accessibilityState={{ selected: chain === k }}
            >
              {k !== 'all' && <ChainDot chain={k} />}
              <Text style={[styles.chipText, { color: t.ink, fontFamily: chain === k ? font.bodyBold : font.body }]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(it) => it.id}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHead}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {section.chain && <ChainDot chain={section.chain} />}
              <Text style={[styles.sectionTitle, { color: t.ink }]}>{section.title}</Text>
            </View>
            {section.windows ? <Text style={[styles.meta, { color: t.muted }]}>{section.windows}</Text> : null}
          </View>
        )}
        renderItem={({ item, section }) => (
          <View style={[styles.deal, { borderColor: t.line }]}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {!section.chain && <ChainDot chain={item.chain} />}
                <ItemName item={item} style={styles.dealName} />
              </View>
              <Text style={[styles.meta, { color: t.muted }]}>{[item.size_text, item.deal_text].filter(Boolean).join(' · ')}</Text>
              <Pressable
                onPress={() => { addItem(shortName(item.name), 'product'); setAdded((a) => ({ ...a, [item.id]: true })); }}
                hitSlop={6}
                accessibilityRole="button"
              >
                <Text style={[styles.add, { color: t.green }]}>{added[item.id] ? 'Added' : 'Add to list'}</Text>
              </Pressable>
            </View>
            <PriceTag item={item} compact />
          </View>
        )}
        ListEmptyComponent={<Text style={[styles.meta, { color: t.muted, paddingVertical: 24 }]}>No deals match that search.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  filters: { paddingHorizontal: 16, gap: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 17, fontFamily: font.body },
  chips: { gap: 6, paddingBottom: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 14 },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  sectionHead: { marginTop: 18, marginBottom: 4 },
  sectionTitle: { fontFamily: font.num, fontSize: 21 },
  deal: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingVertical: 11 },
  dealName: { fontFamily: font.body, fontSize: 15, flexShrink: 1 },
  meta: { fontFamily: font.body, fontSize: 13 },
  add: { fontFamily: font.bodyMedium, fontSize: 13, paddingTop: 4 },
});
