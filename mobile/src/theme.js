// Same palette and type as the web app: green, price-tag yellow, condensed numbers.
import { useColorScheme } from 'react-native';

const light = {
  bg: '#F3F6F4', surface: '#FFFFFF', ink: '#17221E', muted: '#5B6A65', line: '#D9E1DD',
  green: '#1E7A4C', greenInk: '#FFFFFF', tag: '#FFD23F', tagInk: '#1B1A12', tagEdge: '#E3B514', warn: '#9A4A0B',
  safeway: '#C8343A', traderjoes: '#8A3F86', sprouts: '#4F8A2E', costco: '#2C5DA8', kroger: '#0E7A8A', other: '#7A817E',
};
const dark = {
  ...light,
  bg: '#111715', surface: '#1A2320', ink: '#E7EEEB', muted: '#9AAAA4', line: '#2C3834',
  green: '#47BF84', greenInk: '#0D1A13', tag: '#F4C935', tagInk: '#191606', tagEdge: '#B8930F', warn: '#F0A15E',
  kroger: '#3FB4C4', other: '#9AA3A0',
};

export function useTheme() {
  return useColorScheme() === 'dark' ? dark : light;
}

export const font = {
  body: 'Barlow_400Regular',
  bodyMedium: 'Barlow_500Medium',
  bodyBold: 'Barlow_600SemiBold',
  num: 'BarlowCondensed_600SemiBold',
  numBold: 'BarlowCondensed_700Bold',
};

export const chainColor = (t, chain) => t[chain] || t.other;
