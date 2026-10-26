// Title, location chip, and the "Where are you shopping?" sheet (ZIP or GPS).
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppData } from '../state/AppData';
import { useTheme, font } from '../theme';

export default function Header({ title = 'Grocery prices' }) {
  const t = useTheme();
  const { here, setZip, locateMe, loading } = useAppData();
  const [open, setOpen] = useState(false);
  const [zip, setZipText] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setErr(null);
    setBusy(true);
    try { await fn(); setOpen(false); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <View style={styles.header}>
      <Text style={[styles.title, { color: t.ink }]}>{title}</Text>
      <Pressable
        onPress={() => { setZipText(here.zip || ''); setErr(null); setOpen(true); }}
        style={[styles.chip, { borderColor: t.line, backgroundColor: t.surface }]}
        accessibilityRole="button"
        accessibilityLabel={`Location: ${here.label}. Change`}
      >
        {loading ? <ActivityIndicator size="small" color={t.muted} /> : <Ionicons name="location-sharp" size={14} color={t.muted} />}
        <Text style={[styles.chipText, { color: t.muted }]}>{here.label}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.sheet, { backgroundColor: t.surface }]}>
            <Text style={[styles.sheetTitle, { color: t.ink }]}>Where are you shopping?</Text>
            <Text style={[styles.fieldLabel, { color: t.ink }]}>ZIP code</Text>
            <TextInput
              value={zip}
              onChangeText={(v) => setZipText(v.replace(/\D/g, '').slice(0, 5))}
              keyboardType="number-pad"
              placeholder="94080"
              placeholderTextColor={t.muted}
              style={[styles.input, { borderColor: t.line, backgroundColor: t.bg, color: t.ink }]}
              accessibilityLabel="ZIP code"
            />
            {err && <Text style={[styles.err, { color: t.warn }]}>{err}</Text>}
            <View style={styles.actions}>
              <Pressable
                disabled={busy}
                onPress={() => (/^\d{5}$/.test(zip) ? run(() => setZip(zip)) : setErr('Enter a 5-digit ZIP code.'))}
                style={[styles.btn, { backgroundColor: t.green, borderColor: t.green }]}
              >
                <Text style={[styles.btnText, { color: t.greenInk }]}>Use this ZIP</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={() => run(locateMe)} style={[styles.btn, { borderColor: t.line }]}>
                <Text style={[styles.btnText, { color: t.ink }]}>{busy ? 'Locating…' : 'Use my location'}</Text>
              </Pressable>
              <Pressable onPress={() => setOpen(false)} style={styles.btn}>
                <Text style={[styles.btnText, { color: t.muted }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, gap: 10 },
  title: { fontFamily: font.numBold, fontSize: 28 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, flexShrink: 1 },
  chipText: { fontFamily: font.body, fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(10,18,14,0.45)' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 34, gap: 10 },
  sheetTitle: { fontFamily: font.numBold, fontSize: 24 },
  fieldLabel: { fontFamily: font.bodyMedium, fontSize: 14 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 17, fontFamily: font.body },
  err: { fontFamily: font.body, fontSize: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  btn: { borderWidth: 1, borderColor: 'transparent', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11 },
  btnText: { fontFamily: font.bodyBold, fontSize: 15 },
});
