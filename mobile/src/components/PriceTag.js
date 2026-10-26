// The price tag: yellow for sales, white for shelf prices. Same wording as the web app.
import { StyleSheet, Text, View } from 'react-native';
import { money, unitLabel, dealQtyText } from '../lib/shared';
import { useTheme, font } from '../theme';

export function tagText(item) {
  if (!item || item.price == null) return null;
  const lb = item.price_per === 'lb' ? '/lb' : '';
  const user = item.kind === 'user';
  const sale = item.kind === 'sale' || (user && item.is_sale);
  let sub = null;
  if (item.promo) sub = `each ${dealQtyText(item)}`;
  else if (!lb) sub = unitLabel(item.unit_price, item) || null;
  let before = null;
  if (item.regular_price) {
    before = item.promo
      ? { text: `${money(item.regular_price)}${lb} for 1`, strike: false }
      : { text: `Was ${money(item.regular_price)}${lb}`, strike: true };
  }
  const kind = user ? (item.is_sale ? 'Sale, seen in store' : 'Seen in store')
    : item.promo ? item.deal_text
    : item.regular_price && item.deal_text ? item.deal_text
    : sale ? (item.member_price ? 'Member sale' : 'Sale') : 'Shelf price';
  return { price: money(item.price), lb, sub, before, kind, sale };
}

export default function PriceTag({ item, compact = false }) {
  const t = useTheme();
  const info = tagText(item);
  if (!info) {
    return (
      <View style={[styles.tag, { backgroundColor: t.surface, borderColor: t.line }]}>
        <View style={[styles.hole, { backgroundColor: t.bg, borderColor: t.line }]} />
        <Text style={[styles.none, { color: t.muted }]}>{item ? 'See ad' : 'No price'}</Text>
      </View>
    );
  }
  const bg = info.sale ? t.tag : t.surface;
  const ink = info.sale ? t.tagInk : t.ink;
  return (
    <View
      style={[styles.tag, { backgroundColor: bg, borderColor: info.sale ? t.tagEdge : t.line }]}
      accessible
      accessibilityLabel={`${info.price}${info.lb ? ' per pound' : ''}, ${info.kind}`}
    >
      <View style={[styles.hole, { backgroundColor: t.bg, borderColor: info.sale ? t.tagEdge : t.line }]} />
      <Text style={[styles.price, compact && styles.priceCompact, { color: ink }]}>
        {info.price}
        {info.lb ? <Text style={styles.lb}>/lb</Text> : null}
      </Text>
      {info.sub ? <Text style={[styles.small, { color: ink }]}>{info.sub}</Text> : null}
      {info.before ? (
        <Text style={[styles.small, { color: ink }, info.before.strike && styles.strike]}>{info.before.text}</Text>
      ) : null}
      <Text style={[styles.kind, { color: ink }]} numberOfLines={2}>{info.kind}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    minWidth: 86, maxWidth: 140, paddingVertical: 6, paddingLeft: 18, paddingRight: 10,
    borderWidth: 1, borderRadius: 8, alignItems: 'flex-end',
  },
  hole: { position: 'absolute', left: 6, top: '50%', marginTop: -4, width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
  price: { fontFamily: font.numBold, fontSize: 26, lineHeight: 28 },
  priceCompact: { fontSize: 21, lineHeight: 23 },
  lb: { fontSize: 15 },
  small: { fontFamily: font.num, fontSize: 13, opacity: 0.8 },
  strike: { textDecorationLine: 'line-through' },
  kind: { fontFamily: font.bodyBold, fontSize: 12, marginTop: 2, textAlign: 'right' },
  none: { fontFamily: font.num, fontSize: 17, paddingVertical: 4 },
});
