import { useColorScheme } from 'react-native';

export type Theme = {
  bg: string;
  surface: string;
  shade: string;
  weekend: string;
  line: string;
  lineStrong: string;
  ink: string;
  muted: string;
  accent: string;
  onAccent: string;
  holiday: string;
  backdrop: string;
};

const light: Theme = {
  bg: '#f4f6f9',
  surface: '#ffffff',
  shade: '#edf0f5',
  weekend: '#f8f9fb',
  line: '#dde2ea',
  lineStrong: '#b9c1ce',
  ink: '#1a2130',
  muted: '#687386',
  accent: '#2a56c6',
  onAccent: '#ffffff',
  holiday: '#cf423c',
  backdrop: 'rgba(16, 22, 34, 0.35)',
};

const dark: Theme = {
  bg: '#11141a',
  surface: '#171b22',
  shade: '#1d222b',
  weekend: '#191d25',
  line: '#2a313c',
  lineStrong: '#3d4655',
  ink: '#e5e9f0',
  muted: '#8d97a8',
  accent: '#7ea3ff',
  onAccent: '#0f1626',
  holiday: '#e0645e',
  backdrop: 'rgba(0, 0, 0, 0.55)',
};

export const useTheme = () => (useColorScheme() === 'dark' ? dark : light);
