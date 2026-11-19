import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, FormControl, FormControlLabel, FormGroup, FormLabel, Grid,
  LinearProgress, Link, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import useFieldErrors from '../../hooks/useFieldErrors';
import { Section } from '../../components/Badges';
import useAction from '../../hooks/useAction';
import { useIsPhone } from '../../hooks/useResponsive';
import { ReviewItem, Stars } from '../../components/Reviews';
import { createEngineer, getEngineerReviews, listEngineers, updateEngineer } from '../../services/adminService';
import { getFacilities } from '../../services/incidentService';
import { AVAILABILITY_LABELS, CATEGORIES, categoryLabel } from '../../utils/format';

const blankToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

const EMPTY = {
  name: '',
  email: '',
  password: '',
  phone: '',
  department: 'Facilities',
  specializations: [],
  max_active_tickets: 5,
  availability: 'available',
  home_building_id: '',
  notes: '',
  is_active: true,
};

function EngineerForm({ engineer, buildings, onSubmit, onCancel }) {
  const isNew = !engineer;
  const [form, setForm] = useState(() =>
    isNew
      ? EMPTY
      : {
          ...EMPTY,
          ...Object.fromEntries(Object.entries(engineer).map(([k, v]) => [k, v ?? ''])),
          specializations: engineer.specializations ?? [],
        },
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fe = useFieldErrors();

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    fe.clear(k);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const toggleSpec = (c) =>
    setForm((f) => ({
      ...f,
      specializations: f.specializations.includes(c)
        ? f.specializations.filter((x) => x !== c)
        : [...f.specializations, c],
    }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const problems = {};
    if (!form.name.trim()) problems.name = 'Enter the engineer’s name.';
    if (isNew && !form.email.trim().toLowerCase().endsWith('@acme.inc')) problems.email = 'Use an @acme.inc email address.';
    if (isNew && form.password.length < 8) problems.password = 'The temporary password needs at least 8 characters.';
    const max = Number(form.max_active_tickets);
    if (!Number.isInteger(max) || max < 1 || max > 50) problems.max_active_tickets = 'Enter a whole number from 1 to 50.';
    fe.set(problems);
    if (Object.keys(problems).length) return setError('Please fix the highlighted fields.');

    const body = {
      name: form.name.trim(),
      phone: blankToNull(form.phone),
      department: blankToNull(form.department),
      specializations: form.specializations,
      max_active_tickets: Number(form.max_active_tickets),
      availability: form.availability,
      home_building_id: form.home_building_id === '' ? null : Number(form.home_building_id),
      notes: blankToNull(form.notes),
    };
    if (isNew) Object.assign(body, { email: form.email.trim().toLowerCase(), password: form.password });
    else body.is_active = form.is_active;

    setSaving(true);
    try {
      await onSubmit(body);
    } catch (err) {
      setError(fe.fromApi(err) ? 'Please fix the highlighted fields.' : err.message);
      setSaving(false);
    }
  };

  return (
    <Box component="form" onSubmit={submit} noValidate>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField id="eng-name" label="Full name" required disabled={saving} {...fe.props('name')}
            value={form.name} onChange={set('name')}
            slotProps={{ htmlInput: { maxLength: 150 } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          {isNew ? (
            <TextField id="eng-email" label="Work email" required disabled={saving} {...fe.props('email')}
              type="email" value={form.email} onChange={set('email')}
              placeholder="name@acme.inc" />
          ) : (
            <TextField id="eng-email" label="Work email" value={engineer.email} disabled />
          )}
        </Grid>
        {isNew && (
          <Grid size={12}>
            <TextField id="eng-password" label="Temporary password" required disabled={saving}
              {...fe.props('password')} type="text" value={form.password}
              onChange={set('password')} autoComplete="off"
              placeholder="At least 8 characters — share it with the engineer" />
          </Grid>
        )}
        <Grid size={12}>
          <FormControl component="fieldset">
            <FormLabel component="legend" sx={{ fontSize: 14, mb: 0.5 }}>Specialisations</FormLabel>
            <FormGroup row>
              {CATEGORIES.map((c) => (
                <FormControlLabel
                  key={c}
                  label={categoryLabel(c)}
                  control={<Checkbox size="small" checked={form.specializations.includes(c)} onChange={() => toggleSpec(c)} />}
                  sx={{ width: { xs: '50%', sm: 'auto' }, mr: { sm: 2 } }}
                />
              ))}
            </FormGroup>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField id="eng-availability" label="Availability" select disabled={saving}
            {...fe.props('availability')} value={form.availability}
            onChange={set('availability')} slotProps={{ select: { native: true } }}>
            {Object.entries(AVAILABILITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField id="eng-max" label="Max active tickets" required disabled={saving} type="number"
            {...fe.props('max_active_tickets')} value={form.max_active_tickets}
            onChange={set('max_active_tickets')} slotProps={{ htmlInput: { min: 1, max: 50 } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField id="eng-home" label="Home building" select disabled={saving}
            {...fe.props('home_building_id')} value={form.home_building_id}
            onChange={set('home_building_id')}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
            <option value="">—</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField id="eng-phone" label="Phone (optional)" disabled={saving} {...fe.props('phone')}
            value={form.phone} onChange={set('phone')}
            slotProps={{ htmlInput: { maxLength: 30 } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField id="eng-dept" label="Department (optional)" disabled={saving} {...fe.props('department')}
            value={form.department} onChange={set('department')}
            slotProps={{ htmlInput: { maxLength: 100 } }} />
        </Grid>
        <Grid size={12}>
          <TextField id="eng-notes" label="Notes (optional)" disabled={saving} {...fe.props('notes')}
            multiline minRows={2} value={form.notes}
            onChange={set('notes')} slotProps={{ htmlInput: { maxLength: 2000 } }} />
        </Grid>
        {!isNew && (
          <Grid size={12}>
            <FormControlLabel
              control={<Checkbox id="eng-active" checked={form.is_active} onChange={set('is_active')} />}
              label="Account active (unticking signs them out; only possible with no active tickets)"
            />
          </Grid>
        )}
      </Grid>
      <Stack direction="row" spacing={1} sx={{ mt: 2, justifyContent: 'flex-end' }}>
        <Button variant="outlined" color="inherit" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create engineer' : 'Save changes'}
        </Button>
      </Stack>
    </Box>
  );
}

const AVAILABILITY_COLORS = { available: 'success', busy: 'warning', on_leave: 'default', offline: 'default' };

function AvailabilityChip({ availability }) {
  return (
    <Chip size="small" variant="outlined" color={AVAILABILITY_COLORS[availability] ?? 'default'}
      label={AVAILABILITY_LABELS[availability]} />
  );
}

function Workload({ engineer: e }) {
  const pct = Math.min(100, Math.round((e.active_tickets / e.max_active_tickets) * 100));
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 120 }}>
      <LinearProgress
        variant="determinate"
        value={pct}
        color={pct >= 100 ? 'error' : 'primary'}
        aria-label={`Workload ${e.active_tickets} of ${e.max_active_tickets}`}
        sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
        {e.active_tickets} / {e.max_active_tickets}
      </Typography>
    </Stack>
  );
}

/** Average rating; opens the engineer's reviews. Admin-only page, so engineers never see it. */
function RatingCell({ engineer: e, onReviews }) {
  if (!e.review_count) {
    return <Typography variant="body2" color="text.secondary">No reviews</Typography>;
  }
  return (
    <Button
      size="small"
      color="inherit"
      onClick={() => onReviews(e.id)}
      aria-label={`${e.name}: ${e.avg_rating} out of 5 from ${e.review_count} review${e.review_count === 1 ? '' : 's'}. Show reviews`}
      sx={{ textTransform: 'none', gap: 0.75, px: 0.5, minWidth: 0 }}
    >
      <Stars value={e.avg_rating} />
      <Typography component="span" variant="body2" sx={{ fontWeight: 700 }}>{e.avg_rating.toFixed(1)}</Typography>
      <Typography component="span" variant="caption" color="text.secondary">({e.review_count})</Typography>
    </Button>
  );
}

/** Every review of one engineer, newest first. */
function ReviewsPanel({ engineer, onClose }) {
  const [reviews, setReviews] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getEngineerReviews(engineer.id).then(setReviews).catch((err) => setError(err.message));
  }, [engineer.id]);

  return (
    <Section
      title={`Reviews of ${engineer.name}`}
      aside={<Button onClick={onClose}>Close</Button>}
    >
      {error && <Alert severity="error">{error}</Alert>}
      {!reviews && !error && <Typography color="text.secondary">Loading reviews…</Typography>}
      {reviews?.length === 0 && <Typography color="text.secondary">No reviews yet.</Typography>}
      {reviews?.length > 0 && (
        <Stack spacing={1.5}>
          {reviews.map((r) => (
            <ReviewItem
              key={r.id}
              review={r}
              heading={
                <>
                  {r.reviewer_name} on{' '}
                  <Link href={`#/incidents/${r.incident_id}`}>{r.incident_reference}</Link> · {r.incident_title}
                </>
              }
            />
          ))}
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>
        Written by the employees who reported each incident. Engineers can't see their reviews.
      </Typography>
    </Section>
  );
}

const specs = (e) =>
  e.specializations.length ? e.specializations.map(categoryLabel).join(', ') : <Typography component="span" color="text.secondary">—</Typography>;

function NameCell({ engineer: e }) {
  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography sx={{ fontWeight: 700 }}>{e.name}</Typography>
        {!e.is_active && <Chip label="Inactive" size="small" sx={{ height: 20, fontSize: 11 }} />}
      </Stack>
      <Typography variant="body2" color="text.secondary">{e.email}</Typography>
    </>
  );
}

function EngineerTable({ engineers, onEdit, onReviews }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Engineer</TableCell>
            <TableCell>Specialisations</TableCell>
            <TableCell>Availability</TableCell>
            <TableCell>Workload</TableCell>
            <TableCell>Rating</TableCell>
            <TableCell>Home building</TableCell>
            <TableCell aria-label="Actions" />
          </TableRow>
        </TableHead>
        <TableBody>
          {engineers.map((e) => (
            <TableRow key={e.id} hover sx={{ opacity: e.is_active ? 1 : 0.6 }}>
              <TableCell><NameCell engineer={e} /></TableCell>
              <TableCell sx={{ fontSize: 13 }}>{specs(e)}</TableCell>
              <TableCell><AvailabilityChip availability={e.availability} /></TableCell>
              <TableCell><Workload engineer={e} /></TableCell>
              <TableCell><RatingCell engineer={e} onReviews={onReviews} /></TableCell>
              <TableCell sx={{ fontSize: 13 }}>
                {e.home_building ?? <Typography component="span" color="text.secondary">—</Typography>}
              </TableCell>
              <TableCell align="right">
                <Button size="small" onClick={() => onEdit(e.id)}>Edit</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** Phone: one card per engineer. */
function EngineerCards({ engineers, onEdit, onReviews }) {
  return (
    <Stack component="ul" spacing={1.5} aria-label="Engineers" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {engineers.map((e) => (
        <Card key={e.id} component="li" sx={{ opacity: e.is_active ? 1 : 0.6 }}>
          <CardContent sx={{ '&:last-child': { pb: 2 } }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Box sx={{ minWidth: 0 }}><NameCell engineer={e} /></Box>
              <Button size="small" onClick={() => onEdit(e.id)}>Edit</Button>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ my: 1 }}>
              <AvailabilityChip availability={e.availability} />
              <Box sx={{ flexGrow: 1 }}><Workload engineer={e} /></Box>
            </Stack>
            <Typography variant="body2">{specs(e)}</Typography>
            <Box sx={{ my: 0.5 }}><RatingCell engineer={e} onReviews={onReviews} /></Box>
            {e.home_building && <Typography variant="caption" color="text.secondary">{e.home_building}</Typography>}
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

export default function Engineers() {
  const [engineers, setEngineers] = useState(null);
  const [buildings, setBuildings] = useState([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState(null); // null | 'new' | engineer id
  const [reviewing, setReviewing] = useState(null); // engineer id whose reviews are open
  const [notice, setNotice] = useState('');
  const { run, error } = useAction();
  const isPhone = useIsPhone();

  const load = useCallback(
    () => run(async () => setEngineers(await listEngineers(includeInactive))),
    [run, includeInactive],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getFacilities().then(setBuildings).catch(() => setBuildings([]));
  }, []);

  const current = typeof editing === 'number' ? engineers?.find((e) => e.id === editing) : null;
  const reviewed = engineers?.find((e) => e.id === reviewing);

  const save = async (body) => {
    if (editing === 'new') {
      const created = await createEngineer(body);
      setNotice(`${created.name} can now sign in as ${created.email} with the temporary password.`);
    } else {
      const updated = await updateEngineer(editing, body);
      setNotice(`Saved ${updated.name}.`);
    }
    setEditing(null);
    await load();
  };

  const edit = (id) => {
    setEditing(id);
    setNotice('');
  };

  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-start' }, mb: 3 }}>
        <Box>
          <Typography variant="h1">Engineers</Typography>
          <Typography color="text.secondary">
            Engineer profiles, specialisations, availability and current workload.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} sx={{ flexShrink: 0 }} onClick={() => edit('new')}>
          Add engineer
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" role="status" sx={{ mb: 2 }}>{notice}</Alert>}

      {editing !== null && (editing === 'new' || current) && (
        <Section title={editing === 'new' ? 'New engineer' : `Edit ${current.name}`}>
          <EngineerForm
            key={editing}
            engineer={current}
            buildings={buildings}
            onSubmit={save}
            onCancel={() => setEditing(null)}
          />
        </Section>
      )}

      {reviewed && <ReviewsPanel key={reviewed.id} engineer={reviewed} onClose={() => setReviewing(null)} />}

      <Section
        title={engineers ? `${engineers.length} engineer${engineers.length === 1 ? '' : 's'}` : 'Engineers'}
        aside={
          <FormControlLabel
            control={<Switch checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />}
            label="Show inactive"
          />
        }
      >
        {!engineers ? (
          <Typography color="text.secondary">Loading engineers…</Typography>
        ) : engineers.length === 0 ? (
          <Typography color="text.secondary">No engineers yet. Add the first one.</Typography>
        ) : isPhone ? (
          <EngineerCards engineers={engineers} onEdit={edit} onReviews={setReviewing} />
        ) : (
          <EngineerTable engineers={engineers} onEdit={edit} onReviews={setReviewing} />
        )}
      </Section>
    </>
  );
}
