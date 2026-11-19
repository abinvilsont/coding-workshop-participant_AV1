import { useState } from 'react';
import {
  Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, Link, Stack, Typography,
} from '@mui/material';
import { EscalatedBadge, StatusBadge } from './Badges';
import Field, { ErrorText } from './Field';
import { useIsPhone } from '../hooks/useResponsive';
import { navigate } from '../router';
import { requestEscalation } from '../services/incidentService';
import { categoryLabel, timeAgo } from '../utils/format';

const location = (m) => [m.building, m.floor, m.seat && `Seat ${m.seat}`].filter(Boolean).join(' · ');

/** One open incident that may be the same problem, with what the employee can do about it. */
function Match({ match, open, onOpen, onClose }) {
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await requestEscalation(match.id, reason.trim());
      navigate(`/incidents/${match.id}`);
    } catch (err) {
      setError(err);
      setSending(false);
    }
  };

  const mine = match.relation === 'reporter' ? 'You reported this.' : match.relation === 'follower' ? "You're following this." : '';

  return (
    <Card component="li" aria-label={`${match.reference} ${match.title}`}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{match.reference}</Typography>
        <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{match.title}</Typography>
        <Typography variant="body2" color="text.secondary">{location(match)}</Typography>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: 'wrap', mt: 1 }}>
          <StatusBadge status={match.status} />
          {match.is_escalated && <EscalatedBadge />}
          <Typography variant="caption" color="text.secondary">Reported {timeAgo(match.created_at)}</Typography>
        </Stack>

        {mine ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
            <Typography variant="body2">{mine}</Typography>
            <Link href={`#/incidents/${match.id}`} onClick={onClose}>Open it</Link>
          </Stack>
        ) : open ? (
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            <Field
              multiline
              minRows={2}
              label="Why is it urgent? (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              errorText={error?.fields?.reason || (error && !Object.keys(error.fields ?? {}).length ? error.message : '')}
              disabled={sending}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button color="inherit" onClick={() => onOpen(null)} disabled={sending}>Cancel</Button>
              <Button variant="contained" onClick={send} disabled={sending}>
                {sending ? 'Sending…' : 'Send request'}
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Button variant="contained" color="warning" sx={{ mt: 1.5 }} onClick={() => onOpen(match.id)}>
            Request escalation
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Shown before a new report is saved when it looks like an open incident already
 * covers it. The employee can ask for that one to be escalated (and follow it), or
 * report theirs anyway.
 */
export default function AlreadyReportedDialog({ matches, category, onReportAnyway, onClose }) {
  const isPhone = useIsPhone();
  const [openId, setOpenId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reportAnyway = async () => {
    setSaving(true);
    setError('');
    try {
      await onReportAnyway();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullScreen={isPhone} maxWidth="sm" fullWidth aria-labelledby="already-reported-title">
      <DialogTitle id="already-reported-title">This may already be reported</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>
          {matches.length === 1 ? 'An open incident' : `${matches.length} open incidents`} in{' '}
          <strong>{categoryLabel(category)}</strong> {matches.length === 1 ? 'is' : 'are'} already reported at this
          location. If one is your problem, request escalation instead of reporting it again: you'll follow it and get
          every update.
        </Typography>
        <Box component="ul" aria-label="Open incidents like yours" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 1.5 }}>
          {matches.map((m) => (
            <Match key={m.id} match={m} open={openId === m.id} onOpen={setOpenId} onClose={onClose} />
          ))}
        </Box>
      </DialogContent>
      <DialogActions sx={{ flexDirection: 'column', alignItems: 'stretch', px: 3, pb: 2 }}>
        <ErrorText alert>{error}</ErrorText>
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button color="inherit" onClick={onClose} disabled={saving}>Back to form</Button>
          <Button variant="outlined" onClick={reportAnyway} disabled={saving}>
            {saving ? 'Saving…' : "It's a different problem, report it"}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
