import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
// Only the five weights the app uses (the package index would bundle every weight).
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { Barlow_400Regular } from '@expo-google-fonts/barlow/400Regular';
import { Barlow_500Medium } from '@expo-google-fonts/barlow/500Medium';
import { Barlow_600SemiBold } from '@expo-google-fonts/barlow/600SemiBold';
import { AppDataProvider } from '../state/AppData';
import { useTheme, font } from '../theme';

export default function RootLayout() {
  const t = useTheme();
  const [fontsLoaded] = useFonts({ BarlowCondensed_600SemiBold, BarlowCondensed_700Bold, Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold });
  if (!fontsLoaded) return null;

  const icon = (name) => ({ color, size }) => <Ionicons name={name} color={color} size={size} />;
  return (
    <AppDataProvider>
      <StatusBar style="auto" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: t.green,
          tabBarInactiveTintColor: t.muted,
          tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
          tabBarLabelStyle: { fontFamily: font.bodyMedium, fontSize: 12 },
          sceneStyle: { backgroundColor: t.bg },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'My list', tabBarIcon: icon('list') }} />
        <Tabs.Screen name="deals" options={{ title: "This week's deals", tabBarIcon: icon('pricetag') }} />
        <Tabs.Screen name="stores" options={{ title: 'Stores', tabBarIcon: icon('storefront') }} />
      </Tabs>
    </AppDataProvider>
  );
}
