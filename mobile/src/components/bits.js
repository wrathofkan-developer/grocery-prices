// Small shared pieces.
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, chainColor, font } from '../theme';

export function ChainDot({ chain }) {
  const t = useTheme();
  return <View style={[styles.dot, { backgroundColor: chainColor(t, chain) }]} />;
}

/** Item name that opens the product page at the store. */
export function ItemName({ item, style, numberOfLines }) {
  const t = useTheme();
  if (!item.url) return <Text style={[{ color: t.ink }, style]} numberOfLines={numberOfLines}>{item.name}</Text>;
  return (
    <Text
      style={[{ color: t.ink, textDecorationLine: 'underline', textDecorationColor: t.line }, style]}
      numberOfLines={numberOfLines}
      onPress={() => Linking.openURL(item.url)}
      accessibilityRole="link"
    >
      {item.name}
    </Text>
  );
}

export function LinkButton({ label, onPress, muted, accessibilityLabel }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={accessibilityLabel || label}>
      <Text style={[styles.link, { color: muted ? t.muted : t.green }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  link: { fontFamily: font.bodyMedium, fontSize: 14, paddingVertical: 6 },
});
