import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, FormControlLabel, Link, List, ListItem, Stack, TextField, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { EscalatedBadge, PriorityBadge, Section, StatusBadge } from '../components/Badges';
import IncidentForm from '../components/IncidentForm';
import { useIsPhone } from '../hooks/useResponsive';
import { navigate } from '../router';
import { markAllRead } from '../services/notificationService';
import {
  addNote, assignEngineer, changeStatus, deleteIncident, escalateIncident, getEngineers,
  getIncident, updateIncident,
} from '../services/incidentService';
import {
  AVAILABILITY_LABELS, PRIORITIES, ROLE_LABELS, STATUS_LABELS, categoryLabel, formatDateTime,
  timeAgo, titleCase,
} from '../utils/format';

// Button text for a move to each status, depending on where we are now
function transitionLabel(from, to) {
  if (to === 'in_progress') return from === 'resolved' ? 'Reopen' : from === 'on_hold' ? 'Resume work' : 'Start work';
  return {
    open: 'Move back to open',
    assigned: 'Mark assigned',
    on_hold: 'Put on hold',
    resolved: 'Mark resolved',
    closed: 'Confirm fixed & close',
    cancelled: 'Cancel incident',
  }[to];
}

const DANGER = new Set(['cancelled']);

function historyText(h) {
  const from = (v) => STATUS_LABELS[v] ?? titleCase(v);
  switch (h.event_type) {
    case 'created':
      return 'Reported the incident';
    case 'status_change':
      return `Changed status: ${from(h.from_value)} → ${from(h.to_value)}`;
    case 'assignment':
      return h.from_value ? `Reassigned: ${h.from_value} → ${h.to_value}` : `Assigned to ${h.to_value}`;
    case 'priority_change':
      return `Changed priority: ${titleCase(h.from_value)} → ${titleCase(h.to_value)}`;
    case 'priority_request':
      return `Requested priority ${titleCase(h.to_value)}`;
    case 'escalation':
      return 'Escalated the incident';
    default:
      return titleCase(h.event_type);
  }
}

/* ------------------------------------------------------------------ */

const nativeSelect = { select: { native: true }, inputLabel: { shrink: true } };

/** One titled block in the Actions panel; a labelled region so tests and e2e can find it. */
function ActionBlock({ id, title, children }) {
  return (
    <Box
      component="section"
      aria-labelledby={title ? `${id}-title` : undefined}
      sx={{ '&:not(:first-of-type)': { mt: 2.5, pt: 2.5, borderTop: 1, borderColor: 'divider' } }}
    >
      {title && (
        <Typography id={`${id}-title`} variant="h3" component="h3" sx={{ mb: 1.5 }}>{title}</Typography>
      )}
      <Stack spacing={1.5}>{children}</Stack>
    </Box>
  );
}

/** Field + button side by side; stacked on phones. */
function InlineForm({ children }) {
  const isPhone = useIsPhone();
  return (
    <Stack direction={isPhone ? 'column' : 'row'} spacing={1} alignItems={isPhone ? 'stretch' : 'center'}>
      {children}
    </Stack>
  );
}

function StatusActions({ incident, run }) {
  const [comment, setComment] = useState('');
  const transitions = incident.permissions.status_transitions;
  if (!transitions.length) return null;

  const go = (to) => {
    if (to === 'cancelled' && !window.confirm('Cancel this incident?')) return;
    run(() => changeStatus(incident.id, to, comment.trim() || undefined)).then((ok) => ok && setComment(''));
  };

  return (
    <ActionBlock id="status" title="Update status">
      <TextField
        multiline
        minRows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional comment (added as a note)"
        slotProps={{ htmlInput: { maxLength: 2000 } }}
      />
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {transitions.map((to) => (
          <Button
            key={to}
            variant="contained"
            color={DANGER.has(to) ? 'error' : 'primary'}
            onClick={() => go(to)}
          >
            {transitionLabel(incident.status, to)}
          </Button>
        ))}
      </Stack>
    </ActionBlock>
  );
}

function AssignAction({ incident, run }) {
  const [engineers, setEngineers] = useState(null);
  const [selected, setSelected] = useState(incident.assigned_engineer_id ?? '');

  useEffect(() => {
    getEngineers().then(setEngineers).catch(() => setEngineers([]));
  }, []);

  // Follow the incident when its engineer changes (adjusting state during render)
  const [shownEngineer, setShownEngineer] = useState(incident.assigned_engineer_id);
  if (shownEngineer !== incident.assigned_engineer_id) {
    setShownEngineer(incident.assigned_engineer_id);
    setSelected(incident.assigned_engineer_id ?? '');
  }

  return (
    <ActionBlock id="assign" title={incident.assigned_engineer_id ? 'Reassign engineer' : 'Assign engineer'}>
      <InlineForm>
        <TextField
          select
          label="Engineer"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={!engineers}
          slotProps={nativeSelect}
        >
          <option value="">{engineers ? 'Select engineer…' : 'Loading…'}</option>
          {engineers?.map((e) => (
            <option
              key={e.id}
              value={e.id}
              disabled={e.remaining_capacity <= 0 && e.id !== incident.assigned_engineer_id}
            >
              {e.name} · {AVAILABILITY_LABELS[e.availability]} · {e.active_tickets}/{e.max_active_tickets}
              {e.remaining_capacity <= 0 ? ' (full)' : ''}
              {e.specializations.includes(incident.category) ? ' ★' : ''}
            </option>
          ))}
        </TextField>
        <Button
          variant="contained"
          disabled={!selected || Number(selected) === incident.assigned_engineer_id}
          onClick={() => run(() => assignEngineer(incident.id, Number(selected)))}
        >
          Assign
        </Button>
      </InlineForm>
      <Typography variant="caption" color="text.secondary">★ specialises in {categoryLabel(incident.category)}</Typography>
    </ActionBlock>
  );
}

function PriorityAction({ incident, run }) {
  const suggested = incident.requested_priority ?? incident.priority;
  const [priority, setPriority] = useState(suggested);
  const [shownSuggestion, setShownSuggestion] = useState(suggested);
  if (shownSuggestion !== suggested) {
    setShownSuggestion(suggested);
    setPriority(suggested);
  }

  return (
    <ActionBlock id="priority" title="Priority">
      {incident.requested_priority && incident.requested_priority !== incident.priority && (
        <Alert severity="warning" icon={false} sx={{ py: 0 }}>
          Employee requested <strong>{titleCase(incident.requested_priority)}</strong>.
        </Alert>
      )}
      <InlineForm>
        <TextField
          select
          label="New priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          slotProps={nativeSelect}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{titleCase(p)}</option>
          ))}
        </TextField>
        <Button
          variant="contained"
          disabled={priority === incident.priority}
          onClick={() => run(() => updateIncident(incident.id, { priority }))}
          sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Set priority
        </Button>
      </InlineForm>
      {incident.is_escalated && (
        <Button
          fullWidth
          variant="outlined"
          onClick={() => run(() => updateIncident(incident.id, { is_escalated: false }))}
        >
          Clear escalation
        </Button>
      )}
    </ActionBlock>
  );
}

function EscalateAction({ incident, run }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [requested, setRequested] = useState('');
  const higher = PRIORITIES.slice(PRIORITIES.indexOf(incident.priority) + 1);

  if (!open) {
    return (
      <ActionBlock id="escalate" title="Need it sooner?">
        <Button fullWidth variant="outlined" color="warning" onClick={() => setOpen(true)}>
          Escalate / request higher priority
        </Button>
      </ActionBlock>
    );
  }

  const submit = () =>
    run(() => escalateIncident(incident.id, reason.trim(), requested)).then((ok) => ok && setOpen(false));

  return (
    <ActionBlock id="escalate" title="Escalate incident">
      <TextField
        multiline
        minRows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is this urgent?"
        slotProps={{ htmlInput: { maxLength: 2000 } }}
      />
      {higher.length > 0 && (
        <TextField
          select
          label="Priority"
          value={requested}
          onChange={(e) => setRequested(e.target.value)}
          slotProps={nativeSelect}
        >
          <option value="">Keep priority ({titleCase(incident.priority)})</option>
          {higher.map((p) => (
            <option key={p} value={p}>Request {titleCase(p)}</option>
          ))}
        </TextField>
      )}
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button variant="outlined" color="inherit" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="contained" disabled={!reason.trim()} onClick={submit}>
          Escalate
        </Button>
      </Stack>
    </ActionBlock>
  );
}

function Notes({ incident, user, run }) {
  const isPhone = useIsPhone();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const p = incident.permissions;

  const submit = (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    run(() => addNote(incident.id, body.trim(), internal)).then((ok) => {
      if (ok) {
        setBody('');
        setInternal(false);
      }
    });
  };

  return (
    <Section title={`Notes (${incident.notes.length})`}>
      {incident.notes.length ? (
        <List disablePadding sx={{ display: 'grid', gap: 1.5, mb: 2 }}>
          {incident.notes.map((n) => (
            <ListItem
              key={n.id}
              disableGutters
              sx={{
                display: 'block',
                p: 1.5,
                borderRadius: 1,
                border: 1,
                borderColor: n.is_internal ? 'warning.light' : 'divider',
                bgcolor: n.is_internal ? '#fffbeb' : n.author_id === user.id ? '#f5f8ff' : 'background.paper',
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: 'wrap', mb: 0.5 }}>
                <Typography component="strong" sx={{ fontWeight: 700 }}>{n.author_name}</Typography>
                <Typography variant="caption" color="text.secondary">{ROLE_LABELS[n.author_role]}</Typography>
                {n.is_internal && <Chip size="small" color="warning" label="Internal" sx={{ height: 20 }} />}
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 'auto' }}
                  title={formatDateTime(n.created_at)}
                >
                  {timeAgo(n.created_at)}
                </Typography>
              </Stack>
              <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.body}</Typography>
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography color="text.secondary" sx={{ mb: 2 }}>No notes yet.</Typography>
      )}

      {p.can_add_note ? (
        <Stack component="form" spacing={1} onSubmit={submit}>
          <TextField
            multiline
            minRows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a note…"
            slotProps={{ htmlInput: { maxLength: 5000 } }}
          />
          <Stack
            direction={isPhone ? 'column' : 'row'}
            spacing={1}
            justifyContent="space-between"
            alignItems={isPhone ? 'stretch' : 'center'}
          >
            {p.can_add_internal_note ? (
              <FormControlLabel
                control={<Checkbox checked={internal} onChange={(e) => setInternal(e.target.checked)} />}
                label="Internal (hidden from employee)"
              />
            ) : (
              <span />
            )}
            <Button type="submit" variant="contained" disabled={!body.trim()}>Add note</Button>
          </Stack>
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">Notes are closed for this incident.</Typography>
      )}
    </Section>
  );
}

function DetailRow({ label, children }) {
  return (
    <>
      <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0 }}>{children}</Typography>
    </>
  );
}

const BackLink = () => (
  <Link href="#/incidents" underline="hover" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
    <ArrowBackIcon fontSize="small" /> Incidents
  </Link>
);

/* ------------------------------------------------------------------ */

export default function IncidentDetail({ id, user }) {
  const isPhone = useIsPhone();
  const [incident, setIncident] = useState(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  // State is set in promise callbacks, so calling load() from an effect is safe.
  const load = useCallback(
    () => getIncident(id)
      .then((data) => {
        setIncident(data);
        setError('');
        // Viewing an incident counts as reading its notifications
        markAllRead(id).catch(() => {});
      })
      .catch((err) => setError(err.message)),
    [id],
  );

  // App.jsx keys this page by id, so a different incident mounts a fresh page.
  useEffect(() => {
    load();
  }, [load]);

  // Run an action that returns the updated incident. Resolves true on success.
  const run = useCallback(async (action) => {
    setBusy(true);
    setActionError('');
    try {
      const updated = await action();
      if (updated) setIncident(updated);
      return true;
    } catch (err) {
      setActionError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  if (error) {
    return (
      <>
        <BackLink />
        <Alert severity="error">{error}</Alert>
      </>
    );
  }
  if (!incident) return <Typography color="text.secondary">Loading incident…</Typography>;

  const p = incident.permissions;
  const hasActions =
    p.status_transitions.length || p.can_assign || p.can_set_priority || p.can_escalate || p.can_delete;

  const handleDelete = async () => {
    if (!window.confirm(`Permanently delete ${incident.reference}? This cannot be undone.`)) return;
    if (await run(() => deleteIncident(incident.id))) navigate('/incidents');
  };

  return (
    <>
      <Stack
        direction={isPhone ? 'column' : 'row'}
        spacing={2}
        justifyContent="space-between"
        alignItems={isPhone ? 'stretch' : 'flex-start'}
        sx={{ mb: 3 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <BackLink />
          <Typography variant="caption" color="text.secondary" component="p" sx={{ fontFamily: 'monospace' }}>
            {incident.reference}
          </Typography>
          <Typography variant="h1" component="h1" sx={{ overflowWrap: 'anywhere', mb: 1 }}>{incident.title}</Typography>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            useFlexGap
            sx={{ flexWrap: 'wrap' }}
            data-testid="incident-badges"
          >
            <StatusBadge status={incident.status} />
            <PriorityBadge priority={incident.priority} requested={incident.requested_priority} />
            {incident.is_escalated && <EscalatedBadge />}
            <Typography variant="body2" color="text.secondary">{categoryLabel(incident.category)}</Typography>
          </Stack>
        </Box>
        {p.can_edit && !editing && (
          <Button variant="outlined" onClick={() => setEditing(true)} sx={{ flexShrink: 0 }}>
            Edit details
          </Button>
        )}
      </Stack>

      {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}

      <Box
        aria-busy={busy}
        sx={{
          display: 'grid',
          gap: 3,
          gridTemplateColumns: isPhone ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 340px',
          alignItems: 'start',
          opacity: busy ? 0.6 : 1,
          pointerEvents: busy ? 'none' : 'auto',
          transition: 'opacity 0.2s',
          '& > * > section:last-child': { mb: 0 },
        }}
      >
        <Box>
          {editing ? (
            <Section title="Edit details">
              <IncidentForm
                initial={incident}
                showPriority={false}
                submitLabel="Save changes"
                onCancel={() => setEditing(false)}
                onSubmit={async (payload) => {
                  setIncident(await updateIncident(incident.id, payload));
                  setEditing(false);
                }}
              />
            </Section>
          ) : (
            <Section title="Description">
              <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{incident.description}</Typography>
              {incident.is_escalated && incident.escalation_reason && (
                <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>
                  <strong>Escalation reason</strong>
                  <Typography variant="body2">{incident.escalation_reason}</Typography>
                </Alert>
              )}
            </Section>
          )}

          <Notes incident={incident} user={user} run={run} />

          <Section title="History">
            <List disablePadding component="ol">
              {incident.history.map((h, idx) => (
                <ListItem key={h.id} disableGutters alignItems="flex-start" sx={{ gap: 1.5, py: 0.75 }}>
                  <Box
                    aria-hidden="true"
                    sx={{
                      mt: 0.75,
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      flexShrink: 0,
                      bgcolor: idx === incident.history.length - 1 ? 'primary.main' : 'divider',
                    }}
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2">{historyText(h)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {h.changed_by ?? 'System'} · <span title={formatDateTime(h.created_at)}>{timeAgo(h.created_at)}</span>
                    </Typography>
                    {h.comment && <Typography variant="body2" sx={{ fontStyle: 'italic' }}>“{h.comment}”</Typography>}
                  </Box>
                </ListItem>
              ))}
            </List>
          </Section>
        </Box>

        <Box component="aside">
          <Section title="Details">
            <Box
              component="dl"
              data-testid="incident-details"
              sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 1, m: 0 }}
            >
              <DetailRow label="Location">
                {incident.building}
                {incident.floor && <><br />{incident.floor}</>}
                {incident.seat && <><br />Seat {incident.seat}</>}
                {incident.location_details && (
                  <><br /><Typography component="span" variant="body2" color="text.secondary">{incident.location_details}</Typography></>
                )}
              </DetailRow>
              <DetailRow label="Reported by">{incident.reported_by}</DetailRow>
              <DetailRow label="Engineer">
                {incident.assigned_engineer ?? (
                  <Typography component="span" variant="body2" color="text.secondary">Not assigned yet</Typography>
                )}
              </DetailRow>
              <DetailRow label="Reported">{formatDateTime(incident.created_at)}</DetailRow>
              <DetailRow label="Last update">{formatDateTime(incident.updated_at)}</DetailRow>
              {incident.resolved_at && <DetailRow label="Resolved">{formatDateTime(incident.resolved_at)}</DetailRow>}
              {incident.closed_at && <DetailRow label="Closed">{formatDateTime(incident.closed_at)}</DetailRow>}
            </Box>
          </Section>

          {hasActions ? (
            <Section title="Actions">
              <StatusActions incident={incident} run={run} />
              {p.can_assign && <AssignAction incident={incident} run={run} />}
              {p.can_set_priority && <PriorityAction incident={incident} run={run} />}
              {p.can_escalate && <EscalateAction incident={incident} run={run} />}
              {p.can_delete && (
                <ActionBlock id="delete">
                  <Button fullWidth variant="contained" color="error" onClick={handleDelete}>
                    Delete incident
                  </Button>
                </ActionBlock>
              )}
            </Section>
          ) : null}
        </Box>
      </Box>
    </>
  );
}
