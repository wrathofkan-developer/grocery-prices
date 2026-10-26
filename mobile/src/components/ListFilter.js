// Store chips on My list: compare prices only at the stores you pick.
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { CHAINS, chainName } from '../lib/shared';
import { useAppData } from '../state/AppData';
import { useTheme, font } from '../theme';
import { ChainDot } from './bits';

export default function ListFilter() {
  const t = useTheme();
  const { stores, listChains, hideChains, toggleListChain } = useAppData();
  const present = Object.keys(CHAINS).filter((k) => listChains.includes(k));
  if (present.length < 2) return null;
  const allOn = present.every((k) => !hideChains.includes(k));
  const name = (k) => [...new Set(stores.filter((s) => s.chain === k).map((s) => chainName(k, s.banner)))].join(' / ');
  const chips = [['all', 'All stores', allOn], ...present.map((k) => [k, name(k), !allOn && !hideChains.includes(k)])];

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
      {chips.map(([k, label, on]) => (
        <Pressable
          key={k}
          onPress={() => toggleListChain(k)}
          style={[styles.chip, { borderColor: on ? t.ink : t.line, backgroundColor: t.surface }]}
          accessibilityRole="button"
          accessibilityState={{ selected: on }}
        >
          {k !== 'all' && <ChainDot chain={k} />}
          <Text style={[styles.chipText, { color: t.ink, fontFamily: on ? font.bodyBold : font.body }]}>{label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: { gap: 6, paddingBottom: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 14 },
});
