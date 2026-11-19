import { IconButton, Tooltip } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';

/**
 * Switches between light and dark. Until the user picks, the app follows the
 * device setting ('system'); MUI saves the choice in localStorage.
 */
export default function ThemeToggle({ sx }) {
  const { mode, systemMode, setMode } = useColorScheme();
  if (!mode) return null; // not known until mounted
  const current = mode === 'system' ? systemMode ?? 'light' : mode;
  const next = current === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} mode`;

  return (
    <Tooltip title={label}>
      <IconButton aria-label={label} onClick={() => setMode(next)} color="inherit" sx={sx}>
        {current === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
      </IconButton>
    </Tooltip>
  );
}
