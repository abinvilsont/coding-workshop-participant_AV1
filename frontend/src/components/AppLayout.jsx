import { useState } from 'react';
import {
  AppBar, Avatar, Box, Button, Chip, Container, Divider, Drawer, IconButton, List, ListItemButton,
  ListItemText, Stack, Toolbar, Typography,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { TABLET_MAX, WIDE_NAV_MAX, useIsNarrowerThan } from '../hooks/useResponsive';
import { ROLE_LABELS } from '../utils/format';
import NotificationBell from './NotificationBell';
import ThemeToggle from './ThemeToggle';

const NAV = [
  { href: '#/', label: 'Dashboard', match: (p) => p === '/' },
  { href: '#/incidents', label: 'Incidents', match: (p) => p.startsWith('/incidents') && p !== '/incidents/new' },
  { href: '#/incidents/new', label: 'Report incident', match: (p) => p === '/incidents/new' },
  { href: '#/admin/facilities', label: 'Facilities', match: (p) => p === '/admin/facilities', roles: ['facility_admin'] },
  { href: '#/admin/engineers', label: 'Engineers', match: (p) => p === '/admin/engineers', roles: ['facility_admin'] },
  { href: '#/admin/people', label: 'People', match: (p) => p === '/admin/people', roles: ['facility_admin'] },
];

function Brand({ short }) {
  return (
    <Box component="a" href="#/" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.primary', textDecoration: 'none' }}>
      <Avatar variant="rounded" sx={{ width: 32, height: 32, bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 700, fontSize: 16 }}>A</Avatar>
      {!short && <Typography sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>ACME Facility Desk</Typography>}
    </Box>
  );
}

export default function AppLayout({ user, path, onLogout, children }) {
  const items = NAV.filter((n) => !n.roles || n.roles.includes(user.role));
  // Admins have six links: the top bar needs ~1200px before they fit in one row
  const compact = useIsNarrowerThan(items.length > 3 ? WIDE_NAV_MAX : TABLET_MAX);
  // The menu belongs to the page it was opened on, so navigating closes it.
  const [menuPath, setMenuPath] = useState(null);
  const menuOpen = menuPath === path;
  const role = ROLE_LABELS[user.role] ?? user.role;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2 }}>
          {compact && (
            <IconButton edge="start" aria-label="Open menu" onClick={() => setMenuPath(path)}>
              <MenuIcon />
            </IconButton>
          )}
          <Brand short={compact} />
          {!compact && (
            <Box component="nav" aria-label="Main" sx={{ display: 'flex', gap: 0.5, ml: 2 }}>
              {items.map((n) => {
                const active = n.match(path);
                return (
                  <Button
                    key={n.href}
                    href={n.href}
                    color={active ? 'primary' : 'inherit'}
                    aria-current={active ? 'page' : undefined}
                    sx={{ fontWeight: active ? 700 : 500, bgcolor: active ? 'action.selected' : 'transparent' }}
                  >
                    {n.label}
                  </Button>
                );
              })}
            </Box>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <ThemeToggle />
          <NotificationBell path={path} />
          {!compact && (
            <>
              <Stack sx={{ alignItems: 'flex-end' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>{user.name}</Typography>
                <Chip label={role} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
              </Stack>
              <Button variant="outlined" color="inherit" onClick={onLogout}>Sign out</Button>
            </>
          )}
        </Toolbar>
      </AppBar>

      <Drawer anchor="left" open={compact && menuOpen} onClose={() => setMenuPath(null)}>
        <Box sx={{ width: 260 }}>
          <Box sx={{ p: 2 }}>
            <Brand />
            <Typography variant="body2" sx={{ mt: 2, fontWeight: 600 }}>{user.name}</Typography>
            <Typography variant="caption" color="text.secondary">{role}</Typography>
          </Box>
          <Divider />
          <List component="nav" aria-label="Main">
            {items.map((n) => (
              <ListItemButton key={n.href} component="a" href={n.href} selected={n.match(path)}>
                <ListItemText primary={n.label} />
              </ListItemButton>
            ))}
          </List>
          <Divider />
          <Box sx={{ p: 2 }}>
            <Button fullWidth variant="outlined" color="inherit" onClick={onLogout}>Sign out</Button>
          </Box>
        </Box>
      </Drawer>

      <Container component="main" maxWidth="lg" sx={{ py: { xs: 2, sm: 3 }, px: { xs: 2, sm: 3 } }}>
        {children}
      </Container>
    </Box>
  );
}
