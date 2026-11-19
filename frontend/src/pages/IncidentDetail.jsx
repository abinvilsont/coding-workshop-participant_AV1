import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, FormControlLabel, FormLabel, Link, List, ListItem, Rating, Stack,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { EscalatedBadge, PriorityBadge, Section, StatusBadge } from '../components/Badges';
import Field, { ErrorText } from '../components/Field';
import IncidentForm from '../components/IncidentForm';
import { ReviewItem } from '../components/Reviews';
import { useIsPhone } from '../hooks/useResponsive';
import { schemeSx } from '../theme';
import { navigate } from '../router';
import { markAllRead } from '../services/notificationService';
import {
  addNote, assignEngineer, changeStatus, deleteIncident, deleteReview, escalateIncident, getEngineers,
  getIncident, getMergeCandidates, mergeIncident, submitReview, updateIncident, updateReview,
} from '../services/incidentService';
import {
  AVAILABILITY_LABELS, PRIORITIES, RATING_LABELS, ROLE_LABELS, STATUS_LABELS, categoryLabel, formatDateTime,
  starsLabel, timeAgo, titleCase,
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

/**
 * The last failed action's error, if it came from this box. `field(name)` = the API's
 * message for that input; `general` = a message that names no field. Both are shown
 * inside the box, above the field or buttons they're about.
 */
function boxError(err) {
  return {
    field: (name) => err?.fields?.[name],
    general: err && !Object.keys(err.fields).length ? err.message : '',
  };
}

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
    // Buttons line up with the bottom of the field, also when an error sits above the field
    <Stack direction={isPhone ? 'column' : 'row'} spacing={1} alignItems={isPhone ? 'stretch' : 'flex-end'}>
      {children}
    </Stack>
  );
}

function StatusActions({ incident, run, err }) {
  const [comment, setComment] = useState('');
  const e = boxError(err);
  const transitions = incident.permissions.status_transitions;
  if (!transitions.length) return null;

  const go = (to) => {
    if (to === 'cancelled' && !window.confirm('Cancel this incident?')) return;
    run(() => changeStatus(incident.id, to, comment.trim() || undefined)).then((ok) => ok && setComment(''));
  };

  return (
    <ActionBlock id="status" title="Update status">
      <ErrorText alert>{e.general}</ErrorText>
      <Field
        errorText={e.field('comment')}
        multiline
        minRows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional comment (added as a note)"
        slotProps={{ htmlInput: { maxLength: 2000, 'aria-label': 'Status comment' } }}
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

function AssignAction({ incident, run, err }) {
  const e = boxError(err);
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
        <Field
          select
          label="Engineer"
          errorText={e.field('engineer_id') || e.general}
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
        </Field>
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

function PriorityAction({ incident, run, err }) {
  const e = boxError(err);
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
        <Field
          select
          label="New priority"
          errorText={e.field('priority') || e.field('is_escalated') || e.general}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          slotProps={nativeSelect}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{titleCase(p)}</option>
          ))}
        </Field>
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

function EscalateAction({ incident, run, err }) {
  const e = boxError(err);
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
      <Field
        multiline
        minRows={3}
        errorText={e.field('reason') || e.general}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is this urgent?"
        slotProps={{ htmlInput: { maxLength: 2000, 'aria-label': 'Reason for escalating' } }}
      />
      {higher.length > 0 && (
        <Field
          select
          label="Priority"
          errorText={e.field('requested_priority')}
          value={requested}
          onChange={(e) => setRequested(e.target.value)}
          slotProps={nativeSelect}
        >
          <option value="">Keep priority ({titleCase(incident.priority)})</option>
          {higher.map((p) => (
            <option key={p} value={p}>Request {titleCase(p)}</option>
          ))}
        </Field>
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

/** Admin: merge this incident into another open one that reports the same problem. */
function MergeAction({ incident, run, err }) {
  const e = boxError(err);
  const [candidates, setCandidates] = useState(null);
  const [target, setTarget] = useState('');

  useEffect(() => {
    getMergeCandidates(incident.id).then(setCandidates).catch(() => setCandidates([]));
  }, [incident.id]);

  const chosen = candidates?.find((c) => c.id === Number(target));

  const merge = async () => {
    const ok = window.confirm(
      `Merge ${incident.reference} into ${chosen.reference}? ${incident.reference} will be closed as a duplicate, ` +
      `and ${incident.reported_by} will get ${chosen.reference}'s updates.`,
    );
    if (!ok) return;
    // The response is the other incident, so open it instead of showing it here
    if (await run(async () => { await mergeIncident(incident.id, chosen.id); return null; })) {
      navigate(`/incidents/${chosen.id}`);
    }
  };

  return (
    <ActionBlock id="merge" title="Merge duplicate">
      <Typography variant="body2" color="text.secondary">
        Same problem reported twice? Merge this one into the other: both reporters then get every update.
      </Typography>
      {candidates?.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No other open incidents to merge into.</Typography>
      ) : (
        <InlineForm>
          <Field
            select
            label="Merge into"
            errorText={e.field('target_id') || e.general}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={!candidates}
            slotProps={nativeSelect}
          >
            <option value="">{candidates ? 'Select incident…' : 'Loading…'}</option>
            {candidates?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.reference} · {c.title} · {c.building} · {STATUS_LABELS[c.status]}
              </option>
            ))}
          </Field>
          <Button variant="outlined" disabled={!chosen} onClick={merge} sx={{ flexShrink: 0 }}>
            Merge
          </Button>
        </InlineForm>
      )}
      {candidates?.length > 0 && (
        <Typography variant="caption" color="text.secondary">Same building and category first</Typography>
      )}
    </ActionBlock>
  );
}

/** Employee: rate the engineer once the incident is closed. Admin: read every review.
 *  The API never sends reviews to engineers, so they never see this section. */
function ReviewSection({ incident, user, run, err }) {
  const e = boxError(err);
  const isAdmin = user.role === 'facility_admin';
  const mine = incident.reviews.find((r) => r.reviewer_id === user.id);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(null);
  const [hover, setHover] = useState(-1);
  const [comment, setComment] = useState('');
  const canWrite = incident.permissions.can_review || (mine && editing);

  if (isAdmin) {
    if (!incident.reviews.length) return null;
    return (
      <Section title={`Engineer reviews (${incident.reviews.length})`}>
        <Stack spacing={1.5}>
          {incident.reviews.map((r) => (
            <ReviewItem key={r.id} review={r} heading={`${r.reviewer_name} rated ${r.engineer_name}`} />
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>
          Only Facility Admins and the reviewer see reviews. Engineers don't.
        </Typography>
      </Section>
    );
  }
  if (!mine && !incident.permissions.can_review) return null;

  const startEdit = () => {
    setRating(mine.rating);
    setComment(mine.comment ?? '');
    setEditing(true);
  };
  const submit = (e) => {
    e.preventDefault();
    if (!rating) return;
    const save = mine ? updateReview : submitReview;
    run(() => save(incident.id, rating, comment.trim() || null)).then((ok) => {
      if (ok) {
        setEditing(false);
        setComment('');
        setRating(null);
      }
    });
  };
  const remove = () => {
    if (!window.confirm('Delete your review?')) return;
    run(async () => {
      await deleteReview(incident.id);
      return getIncident(incident.id);
    });
  };
  const shown = hover !== -1 ? hover : rating;

  return (
    <Section title={`Rate ${incident.assigned_engineer}`}>
      {mine && !editing ? (
        <>
          <ErrorText alert>{e.general}</ErrorText>
          <ReviewItem review={mine} heading="Your review" />
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button variant="outlined" onClick={startEdit}>Edit review</Button>
            <Button color="error" onClick={remove}>Delete</Button>
          </Stack>
        </>
      ) : canWrite ? (
        <Stack component="form" spacing={1.5} onSubmit={submit} aria-label="Review the engineer">
          <Box>
            <ErrorText id="review-rating-error">{e.field('rating') || e.general}</ErrorText>
            <FormLabel id="review-rating-label" sx={{ display: 'block', mb: 0.5, fontSize: 14 }}>
              How did {incident.assigned_engineer} do?
            </FormLabel>
            <Stack direction="row" spacing={1} alignItems="center">
              <Rating
                name="review-rating"
                aria-labelledby="review-rating-label"
                value={rating}
                size="large"
                getLabelText={starsLabel}
                onChange={(_, v) => setRating(v)}
                onChangeActive={(_, v) => setHover(v)}
              />
              <Typography variant="body2" color="text.secondary">{shown ? RATING_LABELS[shown] : 'Choose 1–5 stars'}</Typography>
            </Stack>
          </Box>
          <Field
            multiline
            minRows={2}
            label="Comment (optional)"
            errorText={e.field('comment')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            {editing && <Button variant="outlined" color="inherit" onClick={() => setEditing(false)}>Cancel</Button>}
            <Button type="submit" variant="contained" disabled={!rating}>
              {mine ? 'Save review' : 'Submit review'}
            </Button>
          </Stack>
        </Stack>
      ) : null}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>
        Only you and Facility Admins see your review. {incident.assigned_engineer} won't.
      </Typography>
    </Section>
  );
}

// Internal notes are amber, your own notes faintly blue; tints work on light and dark
const NOTE_TINTS = {
  internal: schemeSx({ bgcolor: '#fffbeb' }, { bgcolor: 'rgba(245,158,11,0.10)' }),
  own: schemeSx({ bgcolor: '#f5f8ff' }, { bgcolor: 'rgba(109,140,255,0.10)' }),
};
const noteTint = (kind) => NOTE_TINTS[kind] ?? { bgcolor: 'background.paper' };

function Notes({ incident, user, run, err }) {
  const e = boxError(err);
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
              sx={[
                noteTint(n.is_internal ? 'internal' : n.author_id === user.id ? 'own' : null),
                {
                  display: 'block',
                  p: 1.5,
                  borderRadius: 1,
                  border: 1,
                  borderColor: n.is_internal ? 'warning.light' : 'divider',
                },
              ]}
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
          <Field
            multiline
            minRows={3}
            errorText={e.field('body') || e.field('is_internal') || e.general}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a note…"
            slotProps={{ htmlInput: { maxLength: 5000, 'aria-label': 'Note' } }}
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
  const [actionError, setActionError] = useState(null); // { box, message, fields } of the last failed action
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

  // Run an action that returns the updated incident. Resolves true on success. A failure
  // is remembered with the box it came from, which shows it above its own field.
  const run = useCallback(async (action, box) => {
    setBusy(true);
    setActionError(null);
    try {
      const updated = await action();
      if (updated) setIncident(updated);
      return true;
    } catch (err) {
      setActionError({ box, message: err.message, fields: err.fields ?? {} });
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
  // What each box needs: its own `run`, and the last error if it came from that box
  const box = (name) => ({
    run: (action) => run(action, name),
    err: actionError?.box === name ? actionError : null,
  });
  const hasActions =
    p.status_transitions.length || p.can_assign || p.can_set_priority || p.can_escalate || p.can_merge || p.can_delete;
  const me = incident.followers?.find((f) => f.id === user.id);
  // Followers who found this incident while reporting and asked for it to be escalated
  const askedToEscalate = (incident.followers ?? []).filter((f) => f.escalation_requested_at);

  const handleDelete = async () => {
    if (!window.confirm(`Permanently delete ${incident.reference}? This cannot be undone.`)) return;
    if (await run(() => deleteIncident(incident.id), 'delete')) navigate('/incidents');
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
            <StatusBadge status={incident.status} merged={Boolean(incident.merged_into)} />
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

      {incident.merged_into && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This report was merged into{' '}
          <Link href={`#/incidents/${incident.merged_into.id}`}>
            {incident.merged_into.reference} · {incident.merged_into.title}
          </Link>
          , which is about the same problem. Updates continue there.
        </Alert>
      )}
      {me && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You're following this incident because you have the same problem
          {me.escalation_requested_at ? ' and asked for it to be escalated' : ' (your report was merged into it)'}.
          You'll get every update; {incident.reported_by} confirms the fix.
        </Alert>
      )}

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

          <ReviewSection incident={incident} user={user} {...box('review')} />

          <Notes incident={incident} user={user} {...box('notes')} />

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
              {incident.merged_from?.length > 0 && (
                <DetailRow label="Also reported by">
                  {incident.merged_from.map((m, idx) => (
                    <span key={m.id}>
                      {idx > 0 && <br />}
                      {m.reported_by} (<Link href={`#/incidents/${m.id}`}>{m.reference}</Link>)
                    </span>
                  ))}
                </DetailRow>
              )}
              {askedToEscalate.length > 0 && (
                <DetailRow label="Asked to escalate">
                  {askedToEscalate.map((f, idx) => (
                    <span key={f.id}>
                      {idx > 0 && <br />}
                      {f.name}{' '}
                      <Typography component="span" variant="caption" color="text.secondary">
                        {timeAgo(f.escalation_requested_at)}
                      </Typography>
                    </span>
                  ))}
                </DetailRow>
              )}
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
              <StatusActions incident={incident} {...box('status')} />
              {p.can_assign && <AssignAction incident={incident} {...box('assign')} />}
              {p.can_set_priority && <PriorityAction incident={incident} {...box('priority')} />}
              {p.can_escalate && <EscalateAction incident={incident} {...box('escalate')} />}
              {p.can_merge && <MergeAction incident={incident} {...box('merge')} />}
              {p.can_delete && (
                <ActionBlock id="delete">
                  <ErrorText alert>{box('delete').err?.message}</ErrorText>
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
