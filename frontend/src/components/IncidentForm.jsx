import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import useFieldErrors from '../hooks/useFieldErrors';
import { useIsPhone } from '../hooks/useResponsive';
import { getFacilities } from '../services/incidentService';
import { CATEGORIES, PRIORITIES, categoryLabel, titleCase } from '../utils/format';

const EMPTY = {
  title: '',
  description: '',
  category: '',
  priority: 'medium',
  building_id: '',
  floor_id: '',
  seat_id: '',
  location_details: '',
};

// Native <select>: works best on phones and keeps <option> roles for tests
const NATIVE = { select: { native: true }, inputLabel: { shrink: true } };

const toId = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/**
 * Create / edit form. `initial` pre-fills for edits; `showPriority` controls
 * whether the priority picker appears; `allowCritical` is for admins.
 */
export default function IncidentForm({
  initial,
  submitLabel = 'Submit',
  showPriority = true,
  allowCritical = false,
  onSubmit,
  onCancel,
}) {
  const isPhone = useIsPhone();
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, v ?? ''])),
  }));
  const [facilities, setFacilities] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fe = useFieldErrors();

  useEffect(() => {
    getFacilities()
      .then(setFacilities)
      .catch((err) => setError(err.message));
  }, []);

  const building = useMemo(
    () => facilities?.find((b) => b.id === Number(form.building_id)),
    [facilities, form.building_id],
  );
  const floor = building?.floors.find((f) => f.id === Number(form.floor_id));

  const set = (field) => (e) => {
    const value = e.target.value;
    fe.clear(field);
    setForm((f) => {
      const next = { ...f, [field]: value };
      // Changing a parent location clears its children
      if (field === 'building_id') Object.assign(next, { floor_id: '', seat_id: '' });
      if (field === 'floor_id') next.seat_id = '';
      return next;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const problems = {};
    if (!form.title.trim()) problems.title = 'Enter a short title.';
    if (!form.description.trim()) problems.description = 'Describe the problem.';
    if (!form.category) problems.category = 'Choose a category.';
    if (!form.building_id) problems.building_id = 'Choose a building.';
    fe.set(problems);
    if (Object.keys(problems).length) {
      setError('Please fix the highlighted fields.');
      return;
    }
    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category,
      building_id: toId(form.building_id),
      floor_id: toId(form.floor_id),
      seat_id: toId(form.seat_id),
      location_details: form.location_details.trim() || null,
    };
    if (showPriority) payload.priority = form.priority;

    setSaving(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      setError(fe.fromApi(err) ? 'Please fix the highlighted fields.' : err.message);
      setSaving(false);
    }
  };

  const priorities = allowCritical ? PRIORITIES : PRIORITIES.filter((p) => p !== 'critical');
  const cols = (n) => (isPhone ? 'minmax(0, 1fr)' : `repeat(${n}, minmax(0, 1fr))`);

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Stack spacing={2.5}>
        {error && <Alert severity="error">{error}</Alert>}

        <TextField
          label="Title"
          required
          disabled={saving}
          {...fe.props('title')}
          value={form.title}
          onChange={set('title')}
          placeholder="e.g. Air conditioning not working"
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />

        <TextField
          label="Description"
          required
          disabled={saving}
          {...fe.props('description')}
          multiline
          minRows={4}
          value={form.description}
          onChange={set('description')}
          placeholder="What's wrong, since when, and how it affects you"
          slotProps={{ htmlInput: { maxLength: 5000 } }}
        />

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: cols(showPriority ? 2 : 1) }}>
          <TextField
            select
            label="Category"
            required
            disabled={saving}
            {...fe.props('category')}
            value={form.category}
            onChange={set('category')}
            slotProps={NATIVE}
          >
            <option value="">Select…</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{categoryLabel(c)}</option>
            ))}
          </TextField>
          {showPriority && (
            <TextField
              select
              label="Priority"
              disabled={saving}
              {...fe.props('priority')}
              value={form.priority}
              onChange={set('priority')}
              slotProps={NATIVE}
            >
              {priorities.map((p) => (
                <option key={p} value={p}>{titleCase(p)}</option>
              ))}
            </TextField>
          )}
        </Box>

        <Box component="fieldset" sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2, m: 0, minWidth: 0 }}>
          <Typography component="legend" variant="subtitle2" sx={{ px: 0.5 }}>Location</Typography>
          <Stack spacing={2}>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: cols(3) }}>
              <TextField
                select
                label="Building"
                required
                {...fe.props('building_id')}
                value={form.building_id}
                onChange={set('building_id')}
                disabled={!facilities || saving}
                slotProps={NATIVE}
              >
                <option value="">{facilities ? 'Select…' : 'Loading…'}</option>
                {facilities?.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </TextField>
              <TextField
                select
                label="Floor (optional)"
                value={form.floor_id}
                onChange={set('floor_id')}
                {...fe.props('floor_id')}
                disabled={!building || saving}
                slotProps={NATIVE}
              >
                <option value="">—</option>
                {building?.floors.map((f) => (
                  <option key={f.id} value={f.id}>{f.name || `Floor ${f.floor_number}`}</option>
                ))}
              </TextField>
              <TextField
                select
                label="Seat (optional)"
                value={form.seat_id}
                onChange={set('seat_id')}
                {...fe.props('seat_id')}
                disabled={!floor?.seats.length || saving}
                slotProps={NATIVE}
              >
                <option value="">—</option>
                {floor?.seats.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.seat_code}{s.description ? ` – ${s.description}` : ''}
                  </option>
                ))}
              </TextField>
            </Box>
            <TextField
              label="More details (optional)"
              value={form.location_details}
              onChange={set('location_details')}
              disabled={saving}
              {...fe.props('location_details')}
              placeholder="e.g. Kitchen next to lift B"
              slotProps={{ htmlInput: { maxLength: 255 } }}
            />
          </Stack>
        </Box>

        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          {onCancel && (
            <Button variant="outlined" color="inherit" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? 'Saving…' : submitLabel}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
