// One item on your list: best price, where, other stores, quantity, all matches.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { compareValue, money, dayLabel, nearestStore, unitLabel } from '../lib/shared';
import { useAppData } from '../state/AppData';
import { useTheme, font } from '../theme';
import PriceTag from './PriceTag';
import { ChainDot, ItemName, LinkButton } from './bits';

function useWhere() {
  const { storesById, here, labelFor } = useAppData();
  return (item) => {
    const n = nearestStore(item, storesById, here);
    return n ? `${n.store.name}, ${n.d.toFixed(1)} mi` : labelFor(item);
  };
}

export default function ListRow({ entry, analysis }) {
  const t = useTheme();
  const { updateItem, removeItem, labelFor, krogerPending } = useAppData();
  const whereText = useWhere();
  const [open, setOpen] = useState(false);
  const a = analysis;
  const c = a.chosen;
  const others = Object.values(a.perChain)
    .filter((it) => it.price != null && (!c || it.chain !== c.chain))
    .sort(compareValue);
  const until = c && c.kind === 'sale' && c.valid_to ? ` · through ${dayLabel(c.valid_to)}` : '';
  const checkingKroger = krogerPending.has(entry.q.toLowerCase());

  return (
    <View style={[styles.row, { borderColor: t.line }]}>
      <View style={styles.head}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={[styles.name, { color: t.ink }]}>{entry.q}</Text>
          {c ? (
            <>
              <View style={styles.chosen}><ChainDot chain={c.chain} /><ItemName item={c} style={styles.chosenName} /></View>
              <Text style={[styles.where, { color: t.muted }]}>{whereText(c)}{until}{a.pinned ? ' · your pick' : ''}</Text>
            </>
          ) : (
            <Text style={[styles.where, { color: t.warn }]}>
              {a.active.length ? `${a.active.length} ad mention${a.active.length > 1 ? 's' : ''} without a listed price`
                : checkingKroger ? 'Checking Kroger stores…' : `No store has a price for ${entry.q} this week.`}
            </Text>
          )}
        </View>
        <PriceTag item={c || a.active[0] || null} />
      </View>

      {others.length > 0 && (
        <View style={styles.others}>
          <Text style={[styles.where, { color: t.muted }]}>Also </Text>
          {others.map((it) => (
            <View key={it.id} style={styles.otherChip}>
              <ChainDot chain={it.chain} />
              <Text style={[styles.where, { color: t.muted }]}>{labelFor(it)} {money(it.price)}{it.price_per === 'lb' ? '/lb' : ''}</Text>
            </View>
          ))}
        </View>
      )}
      {a.soon && (
        <Text style={[styles.where, { color: t.green, marginTop: 4 }]}>
          {labelFor(a.soon)} drops to {money(a.soon.price)} on {dayLabel(a.soon.valid_from)}
        </Text>
      )}

      <View style={styles.tools}>
        <View style={[styles.qty, { borderColor: t.line, backgroundColor: t.surface }]}>
          <Pressable onPress={() => updateItem(entry.id, { qty: Math.max(1, entry.qty - 1) })} hitSlop={6} style={styles.qtyBtn} accessibilityLabel="Fewer">
            <Text style={[styles.qtySign, { color: t.muted }]}>−</Text>
          </Pressable>
          <Text style={[styles.qtyNum, { color: t.ink }]} accessibilityLiveRegion="polite">{entry.qty}</Text>
          <Pressable onPress={() => updateItem(entry.id, { qty: Math.min(99, entry.qty + 1) })} hitSlop={6} style={styles.qtyBtn} accessibilityLabel="More">
            <Text style={[styles.qtySign, { color: t.muted }]}>+</Text>
          </Pressable>
        </View>
        {a.active.length > 1 && <LinkButton label={open ? 'Hide' : `See all ${a.active.length} matches`} onPress={() => setOpen(!open)} />}
        <View style={{ flex: 1 }} />
        <LinkButton label="Remove" muted onPress={() => removeItem(entry.id)} accessibilityLabel={`Remove ${entry.q}`} />
      </View>

      {open && (
        <View style={[styles.matches, { borderColor: t.line, backgroundColor: t.surface }]}>
          {a.active.slice(0, 25).map((it, i) => {
            const picked = entry.pin === it.id;
            const unit = it.price != null && it.price_per !== 'lb' ? unitLabel(it.unit_price, it) : '';
            return (
              <View key={it.id} style={[styles.match, i > 0 && { borderTopWidth: 1, borderColor: t.line }]}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <View style={styles.chosen}><ChainDot chain={it.chain} /><ItemName item={it} style={styles.matchName} /></View>
                  <Text style={[styles.matchMeta, { color: t.muted }]}>
                    {[whereText(it), it.size_text, it.deal_text].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.matchPrice, { color: t.ink }]}>
                    {it.price != null ? `${money(it.price)}${it.price_per === 'lb' ? '/lb' : ''}` : 'See ad'}
                  </Text>
                  {unit ? <Text style={[styles.matchMeta, { color: t.muted }]}>{unit}</Text> : null}
                  {it.price != null && (
                    <Pressable
                      onPress={() => updateItem(entry.id, { pin: picked ? null : it.id })}
                      style={[styles.pick, { borderColor: picked ? t.green : t.line, backgroundColor: picked ? t.green : 'transparent' }]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: picked }}
                    >
                      <Text style={[styles.pickText, { color: picked ? t.greenInk : t.ink }]}>{picked ? 'Picked' : 'Pick this'}</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderBottomWidth: 1, paddingVertical: 14 },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  name: { fontFamily: font.bodyBold, fontSize: 18, textTransform: 'capitalize' },
  chosen: { flexDirection: 'row', alignItems: 'center', marginTop: 2, flexShrink: 1 },
  chosenName: { fontFamily: font.bodyMedium, fontSize: 14, flexShrink: 1 },
  where: { fontFamily: font.body, fontSize: 14 },
  others: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 6, gap: 4 },
  otherChip: { flexDirection: 'row', alignItems: 'center', marginRight: 8 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  qty: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999 },
  qtyBtn: { width: 36, height: 34, alignItems: 'center', justifyContent: 'center' },
  qtySign: { fontSize: 20 },
  qtyNum: { minWidth: 22, textAlign: 'center', fontFamily: font.num, fontSize: 17 },
  matches: { marginTop: 10, borderWidth: 1, borderRadius: 10 },
  match: { flexDirection: 'row', padding: 12 },
  matchName: { fontFamily: font.body, fontSize: 15, flexShrink: 1 },
  matchMeta: { fontFamily: font.body, fontSize: 13 },
  matchPrice: { fontFamily: font.numBold, fontSize: 20 },
  pick: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginTop: 4 },
  pickText: { fontFamily: font.bodyMedium, fontSize: 13 },
});
