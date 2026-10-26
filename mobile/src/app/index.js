// My list: add items, see the lowest price nearby and where, and the estimated total.
import { useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { analyzeEntry } from '../lib/shared';
import { useAppData } from '../state/AppData';
import { useTheme, font } from '../theme';
import Header from '../components/Header';
import AddBar from '../components/AddBar';
import ListRow from '../components/ListRow';
import TotalBar from '../components/TotalBar';
import ListFilter from '../components/ListFilter';

export default function MyList() {
  const t = useTheme();
  const { list, items, listItems, loading, error, reload } = useAppData();
  const analyses = useMemo(() => list.map((e) => analyzeEntry(listItems, e)), [list, listItems]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.bg }]} edges={['top']}>
      <Header />
      {error && <Text style={[styles.error, { backgroundColor: t.warn }]}>Couldn't load prices: {error}. Pull down to retry.</Text>}
      <FlatList
        data={list}
        keyExtractor={(e) => e.id}
        renderItem={({ item, index }) => <ListRow entry={item} analysis={analyses[index]} />}
        ListHeaderComponent={<><AddBar />{list.length > 0 && <ListFilter />}</>}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: t.muted }]}>
            Your list is empty. Add what you need and you'll see the lowest price nearby and which store has it.
          </Text>
        }
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading && items.length > 0} onRefresh={reload} tintColor={t.muted} />}
      />
      <TotalBar analyses={analyses} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  empty: { fontFamily: 'Barlow_400Regular', fontSize: 16, paddingVertical: 24 },
  error: { color: '#fff', fontFamily: font.body, padding: 10, marginHorizontal: 16, borderRadius: 8, marginBottom: 8 },
});
