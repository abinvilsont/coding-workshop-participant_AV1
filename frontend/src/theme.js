import { createTheme } from '@mui/material/styles';

// ACME Facility Desk look: one brand blue, quiet greys, 8px corners.
// Light and dark colour schemes; MUI writes them as CSS variables and switches
// with a class on <html> ('light' / 'dark'). The choice is saved in localStorage
// ('mui-mode'); until someone picks, the app follows the device setting.
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#1f4fd8', dark: '#163a9f' },
        error: { main: '#dc2626' },
        background: { default: '#f4f6fa', paper: '#ffffff' },
        text: { primary: '#1c2333', secondary: '#5b6475' },
        divider: '#e2e6ee',
      },
    },
    dark: {
      palette: {
        primary: { main: '#6d8cff', dark: '#4f6fe8', contrastText: '#0b1020' },
        error: { main: '#f87171' },
        background: { default: '#0f141f', paper: '#171d2b' },
        text: { primary: '#e6e9f0', secondary: '#9aa3b5' },
        divider: '#2a3243',
      },
    },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    h1: { fontSize: '1.6rem', fontWeight: 700 },
    h2: { fontSize: '1.2rem', fontWeight: 700 },
    h3: { fontSize: '1rem', fontWeight: 700 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiCard: { defaultProps: { variant: 'outlined' } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
  },
});

/**
 * sx for a value that differs between schemes: light(...) applies always,
 * dark(...) overrides it when the dark scheme is active.
 *   sx={schemeSx({ bgcolor: '#fffbeb' }, { bgcolor: 'rgba(245,158,11,0.12)' })}
 */
export const schemeSx = (light, dark) => (t) => ({ ...light, ...t.applyStyles('dark', dark) });

// Colours for status / priority chips: [text, background] in light, then in dark
export const STATUS_COLORS = {
  open: ['#1e40af', '#dbeafe', '#93c5fd', 'rgba(59,130,246,0.2)'],
  assigned: ['#5b21b6', '#ede9fe', '#c4b5fd', 'rgba(139,92,246,0.2)'],
  in_progress: ['#92400e', '#fef3c7', '#fcd34d', 'rgba(245,158,11,0.18)'],
  on_hold: ['#475569', '#e2e8f0', '#cbd5e1', 'rgba(148,163,184,0.2)'],
  resolved: ['#166534', '#dcfce7', '#86efac', 'rgba(34,197,94,0.18)'],
  closed: ['#334155', '#f1f5f9', '#cbd5e1', 'rgba(148,163,184,0.14)'],
  cancelled: ['#64748b', '#f1f5f9', '#94a3b8', 'rgba(148,163,184,0.12)'],
  merged: ['#0f766e', '#ccfbf1', '#5eead4', 'rgba(20,184,166,0.18)'],
};

export const PRIORITY_COLORS = {
  low: ['#334155', '#f1f5f9', '#cbd5e1', 'rgba(148,163,184,0.14)'],
  medium: ['#1e40af', '#dbeafe', '#93c5fd', 'rgba(59,130,246,0.2)'],
  high: ['#9a3412', '#ffedd5', '#fdba74', 'rgba(249,115,22,0.2)'],
  critical: ['#ffffff', '#dc2626', '#ffffff', '#b91c1c'],
};

// Stat card numbers: a palette key, or [light, dark]
export const TONE_COLORS = {
  neutral: 'text.primary',
  info: 'primary.main',
  warning: ['#b45309', '#fbbf24'],
  danger: 'error.main',
  success: ['#15803d', '#4ade80'],
};
