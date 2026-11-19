import { useState } from 'react';
import {
  Alert, Avatar, Box, Button, IconButton, InputAdornment, List, ListItem, ListItemText, Paper, Stack, Tab, Tabs,
  Typography,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import useFieldErrors, { focusFirstError } from '../hooks/useFieldErrors';
import Field, { ErrorText } from '../components/Field';
import { useIsPhone } from '../hooks/useResponsive';
import { ACME_DOMAIN, isAcmeEmail, login, register } from '../services/authService';
import ThemeToggle from '../components/ThemeToggle';

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
      <Avatar variant="rounded" sx={{ width: 56, height: 56, bgcolor: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: 28, fontWeight: 700 }}>
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
      <Avatar variant="rounded" sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 700 }}>A</Avatar>
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
  const fe = useFieldErrors();

  const isRegister = mode === 'register';

  const update = (field) => (e) => {
    fe.clear(field);
    setForm({ ...form, [field]: e.target.value });
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setNotice('');
    fe.clear();
  };

  // Returns { field: message } for every problem (empty when the form is valid)
  const validate = () => {
    const problems = {};
    if (isRegister && !form.name.trim()) problems.name = 'Please enter your full name.';
    if (!form.email) problems.email = 'Enter your work email.';
    else if (!isAcmeEmail(form.email)) problems.email = `Please use your @${ACME_DOMAIN} email address.`;
    if (!form.password) problems.password = 'Enter your password.';
    else if (isRegister && form.password.length < 8) problems.password = 'Password must be at least 8 characters.';
    if (isRegister && form.password !== form.confirm) problems.confirm = 'Passwords do not match.';
    return problems;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    setError('');
    setNotice('');
    const problems = validate();
    fe.set(problems);
    if (Object.keys(problems).length) {
      focusFirstError(formEl);
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
      // A problem with one field is shown above that field; anything else above the button
      if (fe.fromApi(err)) focusFirstError(formEl);
      else setError(err.message);
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
        sx={{
          flex: '1 1 55%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 2, sm: 4 },
          position: 'relative',
        }}
      >
        <ThemeToggle sx={{ position: 'absolute', top: 8, right: 8 }} />
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
            {notice && <Alert severity="success" role="status">{notice}</Alert>}

            {isRegister && (
              <Field
                label="Full name"
                required
                disabled={loading}
                {...fe.props('name')}
                autoComplete="name"
                value={form.name}
                onChange={update('name')}
                placeholder="Jane Doe"
              />
            )}

            <Field
              label="Work email"
              required
              disabled={loading}
              {...fe.props('email')}
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={update('email')}
              placeholder={`name@${ACME_DOMAIN}`}
            />

            <Field
              label="Password"
              required
              disabled={loading}
              {...fe.props('password')}
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
              <Field
                label="Confirm password"
                required
                disabled={loading}
                {...fe.props('confirm')}
                type={passwordType}
                autoComplete="new-password"
                value={form.confirm}
                onChange={update('confirm')}
              />
            )}

            <Box>
              <ErrorText alert>{error}</ErrorText>
              <Button type="submit" variant="contained" size="large" fullWidth disabled={loading}>
                {loading ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
              </Button>
            </Box>

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
