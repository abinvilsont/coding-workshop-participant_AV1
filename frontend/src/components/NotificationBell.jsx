import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge, Box, Button, Divider, IconButton, List, ListItem, ListItemButton, Paper, Stack, Typography,
} from '@mui/material';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import { useIsPhone } from '../hooks/useResponsive';
import { navigate } from '../router';
import {
  NOTIFICATIONS_CHANGED, getUnreadCount, listNotifications, markAllRead, markRead,
} from '../services/notificationService';
import { formatDateTime, timeAgo } from '../utils/format';

const POLL_MS = 30000;

function Empty({ children }) {
  return <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>{children}</Typography>;
}

export default function NotificationBell({ path }) {
  const isPhone = useIsPhone();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const rootRef = useRef(null);

  const refreshCount = useCallback(() => {
    getUnreadCount()
      .then((r) => setCount(r.unread_count))
      .catch(() => {});
  }, []);

  const loadList = useCallback(() => {
    setError('');
    listNotifications()
      .then((r) => {
        setItems(r.items);
        setCount(r.unread_count);
      })
      .catch((err) => setError(err.message));
  }, []);

  // Poll while the tab is visible; refresh on navigation and on local changes
  useEffect(() => {
    refreshCount();
    const tick = () => document.visibilityState === 'visible' && refreshCount();
    const id = setInterval(tick, POLL_MS);
    const onChanged = () => (open ? loadList() : refreshCount());
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refreshCount, loadList, open]);

  // Navigating closes the panel (adjusting state during render, not in an effect)
  const [shownPath, setShownPath] = useState(path);
  if (path !== shownPath) {
    setShownPath(path);
    setOpen(false);
  }

  useEffect(() => {
    refreshCount();
  }, [path, refreshCount]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => rootRef.current && !rootRef.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadList();
  };

  const openItem = async (n) => {
    if (!n.is_read) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      markRead(n.id).catch(() => {});
    }
    setOpen(false);
    if (n.incident_id) navigate(`/incidents/${n.incident_id}`);
  };

  const readAll = async () => {
    await markAllRead().catch(() => {});
    setItems((list) => list?.map((x) => ({ ...x, is_read: true })));
    setCount(0);
  };

  const label = count ? `Notifications, ${count} unread` : 'Notifications';

  // Phone: panel spans the screen under the app bar; desktop: drops down from the bell
  const panelPosition = isPhone
    ? { position: 'fixed', top: 56, left: 8, right: 8 }
    : { position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 380 };

  return (
    <Box ref={rootRef} sx={{ position: 'relative' }}>
      <IconButton
        onClick={toggle}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        title={label}
        color={open ? 'primary' : 'default'}
      >
        <Badge badgeContent={count} max={99} color="error">
          <NotificationsNoneOutlined />
        </Badge>
      </IconButton>

      {open && (
        <Paper
          role="dialog"
          aria-label="Notifications"
          elevation={8}
          sx={{ ...panelPosition, zIndex: (t) => t.zIndex.modal, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1 }}>
            <Typography sx={{ fontWeight: 700 }}>Notifications</Typography>
            <Button size="small" onClick={readAll} disabled={!count}>Mark all as read</Button>
          </Stack>
          <Divider />
          {error && <Empty>{error}</Empty>}
          {!error && items === null && <Empty>Loading…</Empty>}
          {!error && items?.length === 0 && (
            <Empty>You're all caught up. Updates about your incidents will appear here.</Empty>
          )}
          {items?.length > 0 && (
            <List disablePadding sx={{ overflowY: 'auto' }}>
              {items.map((n) => (
                <ListItem key={n.id} disablePadding divider>
                  <ListItemButton
                    component="button"
                    onClick={() => openItem(n)}
                    disabled={!n.incident_id && n.is_read}
                    sx={{
                      alignItems: 'flex-start', gap: 1.5, width: '100%', textAlign: 'left',
                      bgcolor: n.is_read ? 'transparent' : 'action.hover',
                    }}
                  >
                    <Box
                      component="span"
                      aria-label={n.is_read ? undefined : 'Unread'}
                      sx={{
                        mt: 0.75, flex: '0 0 8px', width: 8, height: 8, borderRadius: '50%',
                        bgcolor: n.is_read ? 'transparent' : 'primary.main',
                      }}
                    />
                    <Box component="span" sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <Typography component="span" variant="body2" sx={{ fontWeight: n.is_read ? 400 : 600 }}>
                        {n.message}
                      </Typography>
                      <Typography component="span" variant="caption" color="text.secondary" title={formatDateTime(n.created_at)}>
                        {timeAgo(n.created_at)}
                      </Typography>
                    </Box>
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </Paper>
      )}
    </Box>
  );
}
