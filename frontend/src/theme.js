import { createTheme } from '@mui/material/styles';

// ACME Facility Desk look: one brand blue, quiet greys, 8px corners.
export const theme = createTheme({
  palette: {
    primary: { main: '#1f4fd8', dark: '#163a9f' },
    error: { main: '#dc2626' },
    background: { default: '#f4f6fa', paper: '#ffffff' },
    text: { primary: '#1c2333', secondary: '#5b6475' },
    divider: '#e2e6ee',
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

// Colours for status / priority chips (text, background)
export const STATUS_COLORS = {
  open: ['#1e40af', '#dbeafe'],
  assigned: ['#5b21b6', '#ede9fe'],
  in_progress: ['#92400e', '#fef3c7'],
  on_hold: ['#475569', '#e2e8f0'],
  resolved: ['#166534', '#dcfce7'],
  closed: ['#334155', '#f1f5f9'],
  cancelled: ['#64748b', '#f1f5f9'],
  merged: ['#0f766e', '#ccfbf1'],
};

export const PRIORITY_COLORS = {
  low: ['#334155', '#f1f5f9'],
  medium: ['#1e40af', '#dbeafe'],
  high: ['#9a3412', '#ffedd5'],
  critical: ['#ffffff', '#dc2626'],
};

export const TONE_COLORS = {
  neutral: 'text.primary',
  info: 'primary.main',
  warning: '#b45309',
  danger: 'error.main',
  success: '#15803d',
};
