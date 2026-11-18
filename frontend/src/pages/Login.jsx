import { useState } from 'react';
import {
  Alert, Avatar, Box, Button, IconButton, InputAdornment, List, ListItem, ListItemText, Paper, Stack, Tab, Tabs,
  TextField, Typography,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { useIsPhone } from '../hooks/useResponsive';
import { ACME_DOMAIN, isAcmeEmail, login, register } from '../services/authService';

const PERSONAS = [
  { role: 'Employee', text: 'Report and track facility & workplace tech issues' },
  { role: 'Facility Admin', text: 'Manage facilities, engineers and ticket assignment' },
  { role: 'Engineer', text: 'Resolve assigned tickets and update requesters' },
];

const TAGLINE = 'One place to report, track and resolve facility and workplace technology incidents.';

function BrandPanel() {
  return (
    <Box
      component="aside"
      sx={{
        flex: '1 1 45%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3,
        p: { md: 6, sm: 4 }, color: '#fff',
        background: 'linear-gradient(160deg, #1f4fd8 0%, #163a9f 100%)',
      }}
    >
      <Avatar variant="rounded" sx={{ width: 56, height: 56, bgcolor: 'rgba(255,255,255,0.18)', fontSize: 28, fontWeight: 700 }}>
        A
      </Avatar>
      <Typography variant="h1" sx={{ fontSize: '2rem' }}>ACME Facility Desk</Typography>
      <Typography sx={{ opacity: 0.9, maxWidth: 420 }}>{TAGLINE}</Typography>
      <List disablePadding sx={{ maxWidth: 420 }}>
        {PERSONAS.map((p) => (
          <ListItem key={p.role} disableGutters sx={{ borderTop: '1px solid rgba(255,255,255,0.2)', py: 1.5 }}>
            <ListItemText
              primary={p.role}
              secondary={p.text}
              slotProps={{
                primary: { sx: { fontWeight: 700 } },
                secondary: { sx: { color: 'rgba(255,255,255,0.8)' } },
              }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}

/** Phone: a compact brand header instead of the side panel. */
function BrandHeader() {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 3 }}>
      <Avatar variant="rounded" sx={{ bgcolor: 'primary.main', fontWeight: 700 }}>A</Avatar>
      <Box>
        <Typography variant="h1" sx={{ fontSize: '1.25rem' }}>ACME Facility Desk</Typography>
        <Typography variant="body2" color="text.secondary">{TAGLINE}</Typography>
      </Box>
    </Stack>
  );
}

export default function Login({ onLogin }) {
  const isPhone = useIsPhone();
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isRegister = mode === 'register';

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setNotice('');
  };

  const validate = () => {
    if (!form.email || !form.password) return 'Email and password are required.';
    if (!isAcmeEmail(form.email)) return `Please use your @${ACME_DOMAIN} email address.`;
    if (isRegister) {
      if (!form.name.trim()) return 'Please enter your full name.';
      if (form.password.length < 8) return 'Password must be at least 8 characters.';
      if (form.password !== form.confirm) return 'Passwords do not match.';
    }
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setLoading(true);
    try {
      if (isRegister) {
        await register(form.name, form.email, form.password);
        setForm({ ...form, password: '', confirm: '' });
        setMode('signin');
        setNotice('Account created. You can now sign in.');
      } else {
        const user = await login(form.email, form.password);
        onLogin?.(user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const passwordType = showPassword ? 'text' : 'password';

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {!isPhone && <BrandPanel />}

      <Box
        component="main"
        sx={{ flex: '1 1 55%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 2, sm: 4 } }}
      >
        <Paper
          component="form"
          variant="outlined"
          onSubmit={handleSubmit}
          noValidate
          sx={{ width: '100%', maxWidth: 420, p: { xs: 2.5, sm: 4 } }}
        >
          {isPhone && <BrandHeader />}

          <Tabs
            value={mode}
            onChange={(_e, next) => switchMode(next)}
            variant="fullWidth"
            sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab value="signin" label="Sign in" />
            <Tab value="register" label="Register" />
          </Tabs>

          <Typography variant="h2" component="h2">
            {isRegister ? 'Create your employee account' : 'Welcome back'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
            {isRegister
              ? `Employees can self-register with an @${ACME_DOMAIN} email.`
              : 'Sign in as an Employee, Facility Admin or Engineer.'}
          </Typography>

          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            {notice && <Alert severity="success" role="status">{notice}</Alert>}

            {isRegister && (
              <TextField
                label="Full name"
                autoComplete="name"
                value={form.name}
                onChange={update('name')}
                placeholder="Jane Doe"
              />
            )}

            <TextField
              label="Work email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={update('email')}
              placeholder={`name@${ACME_DOMAIN}`}
            />

            <TextField
              label="Password"
              type={passwordType}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={form.password}
              onChange={update('password')}
              placeholder={isRegister ? 'At least 8 characters' : '••••••••'}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={() => setShowPassword((s) => !s)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />

            {isRegister && (
              <TextField
                label="Confirm password"
                type={passwordType}
                autoComplete="new-password"
                value={form.confirm}
                onChange={update('confirm')}
              />
            )}

            <Button type="submit" variant="contained" size="large" disabled={loading}>
              {loading ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
            </Button>

            <Typography variant="caption" color="text.secondary" align="center">
              {isRegister
                ? 'Engineer and Facility Admin accounts are created by your Facility Admin.'
                : 'Trouble signing in? Contact your Facility Admin.'}
            </Typography>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
