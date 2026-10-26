// Add box with the suggestion list: plain item first ("Eggs"), then specific products.
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { suggest, money } from '../lib/shared';
import { useAppData } from '../state/AppData';
import { useTheme, font } from '../theme';
import { ChainDot } from './bits';

export default function AddBar() {
  const t = useTheme();
  const { items, addItem, labelFor } = useAppData();
  const [text, setText] = useState('');
  const opts = useMemo(
    () => (text.trim() ? suggest(items, text.trim(), undefined, { labelOf: labelFor }) : []),
    [text, items, labelFor],
  );

  const choose = (o) => {
    addItem(o.q, o.type === 'product' ? 'product' : 'generic');
    setText('');
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Add an item, like oat milk or eggs"
          placeholderTextColor={t.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => { if (text.trim()) choose(opts[0] || { type: 'generic', q: text.trim() }); }}
          style={[styles.input, { backgroundColor: t.surface, borderColor: t.line, color: t.ink }]}
          accessibilityLabel="Add an item"
        />
        <Pressable
          onPress={() => { if (text.trim()) choose(opts[0] || { type: 'generic', q: text.trim() }); }}
          style={[styles.add, { backgroundColor: t.green }]}
          accessibilityRole="button"
        >
          <Text style={[styles.addText, { color: t.greenInk }]}>Add</Text>
        </Pressable>
      </View>

      {opts.length > 0 && (
        <View style={[styles.box, { backgroundColor: t.surface, borderColor: t.line }]} accessibilityRole="menu">
          {opts.map((o, i) => {
            const firstProduct = o.type === 'product' && (i === 0 || opts[i - 1].type !== 'product');
            const meta = o.type === 'generic'
              ? (o.count ? `${o.count} match${o.count > 1 ? 'es' : ''} at ${o.stores.join(', ')}` : o.count === 0 ? 'No store has a price this week' : 'Add as typed')
              : null;
            return (
              <View key={`${o.type}-${o.label}-${i}`}>
                {firstProduct && i > 0 && <View style={[styles.sep, { backgroundColor: t.line }]} />}
                <Pressable
                  onPress={() => choose(o)}
                  style={({ pressed }) => [styles.opt, (pressed || i === 0) && { backgroundColor: t.bg }]}
                  accessibilityRole="menuitem"
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[o.type === 'generic' ? styles.optGeneric : styles.optName, { color: t.ink }]}>{o.label}</Text>
                    {meta ? <Text style={[styles.meta, { color: t.muted }]}>{meta}</Text> : (
                      <View style={styles.storesRow}>
                        {o.stores.map((s) => (
                          <View key={s.name} style={styles.storeChip}><ChainDot chain={s.chain} /><Text style={[styles.meta, { color: t.muted }]}>{s.name}</Text></View>
                        ))}
                      </View>
                    )}
                  </View>
                  {o.low != null && <Text style={[styles.optPrice, { color: t.ink }]}>{money(o.low)}</Text>}
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, fontFamily: font.body },
  add: { borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  addText: { fontFamily: font.bodyBold, fontSize: 16 },
  box: { marginTop: 6, borderWidth: 1, borderRadius: 10, paddingVertical: 4, overflow: 'hidden' },
  sep: { height: 1, marginVertical: 4 },
  opt: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
  optGeneric: { fontFamily: font.bodyBold, fontSize: 16, textTransform: 'capitalize' },
  optName: { fontFamily: font.body, fontSize: 16 },
  meta: { fontFamily: font.body, fontSize: 13 },
  storesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 },
  storeChip: { flexDirection: 'row', alignItems: 'center' },
  optPrice: { fontFamily: font.num, fontSize: 18 },
});
