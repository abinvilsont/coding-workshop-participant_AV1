import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Grid, List, ListItemButton, ListItemText, Paper, Stack, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { Section } from '../../components/Badges';
import Field, { ErrorText } from '../../components/Field';
import { useIsPhone } from '../../hooks/useResponsive';
import {
  createBuilding, createFloor, createSeat, deleteBuilding, deleteFloor, deleteSeat,
  getFacilitiesTree, updateBuilding, updateFloor, updateSeat,
} from '../../services/adminService';

const blankToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const mono = { fontFamily: 'monospace' };
const inactiveSx = (active) => (active ? {} : { opacity: 0.6 });

function ActiveTag({ active }) {
  return active ? null : <Chip label="Inactive" size="small" sx={{ height: 20, fontSize: 11 }} />;
}

/**
 * Runs one change through the page's `run` and keeps its error HERE, so it is shown
 * beside the control that made it rather than at the top of the page.
 * `fields` = messages for named fields; `general` = a message that names no field.
 */
function useLocalAction(run) {
  const [err, setErr] = useState(null);
  const act = async (fn) => {
    setErr(null);
    try {
      return await run(fn);
    } catch (e) {
      setErr(e);
      return undefined;
    }
  };
  const fields = err?.fields ?? {};
  const general = err && !Object.keys(fields).length ? err.message : '';
  return { act, fields, general, clear: () => setErr(null) };
}

/** Small text buttons used for row actions (Edit / Deactivate / Delete). */
function RowActions({ children, label }) {
  return (
    <Stack direction="row" spacing={0.5} role="group" aria-label={label} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {children}
    </Stack>
  );
}

const ActionButton = (props) => <Button size="small" sx={{ minWidth: 0 }} {...props} />;

/* ------------------------------------------------------------ buildings */

const EMPTY_BUILDING = { code: '', name: '', address: '', city: '', country: '' };

const REQUIRED_BUILDING = { code: 'Enter a short code, e.g. HQ2.', name: 'Enter the building name.' };

function BuildingForm({ initial = EMPTY_BUILDING, submitLabel, onSubmit, onCancel, serverErrors = {}, error = '', busy = false }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY_BUILDING,
    ...Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v ?? ''])),
  }));
  const [touched, setTouched] = useState({});
  const [edited, setEdited] = useState({}); // fields changed since the last server error
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setEdited((t) => ({ ...t, [k]: true }));
  };
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));
  // Message above a field: a required field left empty, else the API's message for it
  const fieldProps = (k) => {
    const message = (REQUIRED_BUILDING[k] && touched[k] && !form[k].trim() && REQUIRED_BUILDING[k])
      || (!edited[k] && serverErrors[k]) || '';
    return { errorText: message || undefined, onBlur: blur(k), disabled: busy };
  };
  const submit = (e) => {
    e.preventDefault();
    setEdited({});
    onSubmit({
      code: form.code.trim(),
      name: form.name.trim(),
      address: blankToNull(form.address),
      city: blankToNull(form.city),
      country: blankToNull(form.country),
    });
  };
  return (
    <Box component="form" onSubmit={submit}>
      <Grid container spacing={2} sx={{ alignItems: 'flex-end' }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Field id="bld-code" label="Code" {...fieldProps('code')} value={form.code} onChange={set('code')} required
            placeholder="HQ2" slotProps={{ htmlInput: { maxLength: 20 } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 8 }}>
          <Field id="bld-name" label="Name" {...fieldProps('name')} value={form.name} onChange={set('name')} required
            placeholder="ACME North Campus" slotProps={{ htmlInput: { maxLength: 150 } }} />
        </Grid>
        <Grid size={12}>
          <Field id="bld-address" label="Address (optional)" {...fieldProps('address')} value={form.address} onChange={set('address')}
            slotProps={{ htmlInput: { maxLength: 255 } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <Field id="bld-city" label="City (optional)" {...fieldProps('city')} value={form.city} onChange={set('city')}
            slotProps={{ htmlInput: { maxLength: 100 } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <Field id="bld-country" label="Country (optional)" {...fieldProps('country')} value={form.country} onChange={set('country')}
            slotProps={{ htmlInput: { maxLength: 100 } }} />
        </Grid>
      </Grid>
      <ErrorText alert sx={{ mt: 2 }}>{error}</ErrorText>
      <Stack direction="row" spacing={1} sx={{ mt: error ? 0 : 2, justifyContent: 'flex-end' }}>
        <Button variant="outlined" color="inherit" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={busy || !form.code.trim() || !form.name.trim()}>
          {submitLabel}
        </Button>
      </Stack>
    </Box>
  );
}

/* ------------------------------------------------------------ seats */

function SeatActions({ seat, run, onEdit }) {
  const { act, general } = useLocalAction(run);
  return (
    <Box>
      <ErrorText alert>{general}</ErrorText>
      <RowActions label={`Seat ${seat.seat_code} actions`}>
        <ActionButton onClick={onEdit}>Edit</ActionButton>
        <ActionButton onClick={() => act(() => updateSeat(seat.id, { is_active: !seat.is_active }))}>
          {seat.is_active ? 'Deactivate' : 'Reactivate'}
        </ActionButton>
        <ActionButton
          color="error"
          onClick={() => window.confirm(`Delete seat ${seat.seat_code}?`) && act(() => deleteSeat(seat.id))}
        >
          Delete
        </ActionButton>
      </RowActions>
    </Box>
  );
}

function useSeatEditor({ seat, run, onDone }) {
  const [code, setCode] = useState(seat.seat_code);
  const [desc, setDesc] = useState(seat.description ?? '');
  const { act, fields, general } = useLocalAction(run);
  const save = async () => {
    if (await act(() => updateSeat(seat.id, { seat_code: code.trim(), description: blankToNull(desc) }))) onDone();
  };
  return {
    code: <Field value={code} onChange={(e) => setCode(e.target.value)} errorText={fields.seat_code || general}
      slotProps={{ htmlInput: { 'aria-label': 'Seat code', maxLength: 30 } }} />,
    desc: <Field value={desc} onChange={(e) => setDesc(e.target.value)} errorText={fields.description}
      slotProps={{ htmlInput: { 'aria-label': 'Description', maxLength: 255 } }} />,
    actions: (
      <RowActions label={`Seat ${seat.seat_code} edit`}>
        <ActionButton onClick={onDone}>Cancel</ActionButton>
        <ActionButton variant="contained" disabled={!code.trim()} onClick={save}>Save</ActionButton>
      </RowActions>
    ),
  };
}

function SeatRow({ seat, run }) {
  const [editing, setEditing] = useState(false);
  return editing ? <EditingSeatRow seat={seat} run={run} onDone={() => setEditing(false)} /> : (
    <TableRow sx={inactiveSx(seat.is_active)}>
      <TableCell sx={mono}>{seat.seat_code}</TableCell>
      <TableCell>{seat.description || <Typography component="span" color="text.secondary">—</Typography>}</TableCell>
      <TableCell><ActiveTag active={seat.is_active} /></TableCell>
      <TableCell align="right"><SeatActions seat={seat} run={run} onEdit={() => setEditing(true)} /></TableCell>
    </TableRow>
  );
}

function EditingSeatRow(props) {
  const ui = useSeatEditor(props);
  return (
    <TableRow>
      <TableCell>{ui.code}</TableCell>
      <TableCell>{ui.desc}</TableCell>
      <TableCell />
      <TableCell align="right">{ui.actions}</TableCell>
    </TableRow>
  );
}

/** Phone: a seat as a stacked list item instead of a table row. */
function SeatCard({ seat, run }) {
  const [editing, setEditing] = useState(false);
  return (
    <Box component="li" sx={{ py: 1, borderTop: 1, borderColor: 'divider', ...inactiveSx(seat.is_active || editing) }}>
      {editing ? <EditingSeatCard seat={seat} run={run} onDone={() => setEditing(false)} /> : (
        <>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={mono}>{seat.seat_code}</Typography>
            <ActiveTag active={seat.is_active} />
          </Stack>
          {seat.description && <Typography variant="body2" color="text.secondary">{seat.description}</Typography>}
          <SeatActions seat={seat} run={run} onEdit={() => setEditing(true)} />
        </>
      )}
    </Box>
  );
}

function EditingSeatCard(props) {
  const ui = useSeatEditor(props);
  return <Stack spacing={1}>{ui.code}{ui.desc}{ui.actions}</Stack>;
}

function SeatList({ seats, run }) {
  const isPhone = useIsPhone();
  if (isPhone) {
    return (
      <Box component="ul" aria-label="Seats" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {seats.map((s) => <SeatCard key={s.id} seat={s} run={run} />)}
      </Box>
    );
  }
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Seat</TableCell>
            <TableCell>Description</TableCell>
            <TableCell>Status</TableCell>
            <TableCell aria-label="Actions" />
          </TableRow>
        </TableHead>
        <TableBody>
          {seats.map((s) => <SeatRow key={s.id} seat={s} run={run} />)}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function AddSeat({ floorId, run }) {
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');
  const { act, fields, general } = useLocalAction(run);
  const submit = async (e) => {
    e.preventDefault();
    if (await act(() => createSeat({ floor_id: floorId, seat_code: code.trim(), description: blankToNull(desc) }))) {
      setCode('');
      setDesc('');
    }
  };
  return (
    <Stack component="form" onSubmit={submit} direction={{ xs: 'column', sm: 'row' }} spacing={1}
      sx={{ mt: 1.5, alignItems: { sm: 'flex-end' } }}>
      <Field value={code} onChange={(e) => setCode(e.target.value)} placeholder="Seat code, e.g. 3A-042"
        errorText={fields.seat_code || general} sx={{ flex: 1 }}
        slotProps={{ htmlInput: { 'aria-label': 'New seat code', maxLength: 30 } }} />
      <Field value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description (optional)"
        errorText={fields.description} sx={{ flex: 1 }}
        slotProps={{ htmlInput: { 'aria-label': 'New seat description', maxLength: 255 } }} />
      <Button type="submit" variant="outlined" startIcon={<AddIcon />} disabled={!code.trim()} sx={{ flexShrink: 0 }}>
        Add seat
      </Button>
    </Stack>
  );
}

/* ------------------------------------------------------------ floors */

function FloorBlock({ floor, run }) {
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(String(floor.floor_number));
  const [name, setName] = useState(floor.name ?? '');
  const edit = useLocalAction(run);
  const rowAction = useLocalAction(run);
  const activeSeats = floor.seats.filter((s) => s.is_active).length;

  return (
    <Paper
      component="section"
      aria-label={`Floor ${floor.floor_number}`}
      variant="outlined"
      sx={{ p: 2, mb: 2, bgcolor: floor.is_active ? 'background.paper' : 'action.hover' }}
    >
      {editing ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-end' } }}>
          <Field type="number" value={number} onChange={(e) => setNumber(e.target.value)} sx={{ width: { sm: 160 } }}
            errorText={edit.fields.floor_number || edit.general}
            slotProps={{ htmlInput: { 'aria-label': 'Floor number' } }} />
          <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Floor name" sx={{ flex: 1 }}
            errorText={edit.fields.name}
            slotProps={{ htmlInput: { 'aria-label': 'Floor name', maxLength: 100 } }} />
          <Button variant="outlined" color="inherit" onClick={() => setEditing(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={number === ''}
            onClick={async () => {
              if (await edit.act(() => updateFloor(floor.id, { floor_number: Number(number), name: blankToNull(name) }))) {
                setEditing(false);
              }
            }}
          >
            Save
          </Button>
        </Stack>
      ) : (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5, ...inactiveSx(floor.is_active) }}>
            <Typography sx={{ fontWeight: 700 }}>Floor {floor.floor_number}</Typography>
            {floor.name && <Typography color="text.secondary">{floor.name}</Typography>}
            <ActiveTag active={floor.is_active} />
            <Typography variant="caption" color="text.secondary">{plural(activeSeats, 'active seat')}</Typography>
          </Stack>
          <Box>
            <ErrorText alert>{rowAction.general}</ErrorText>
            <RowActions label={`Floor ${floor.floor_number} actions`}>
              <ActionButton onClick={() => { edit.clear(); setEditing(true); }}>Edit</ActionButton>
              <ActionButton onClick={() => rowAction.act(() => updateFloor(floor.id, { is_active: !floor.is_active }))}>
                {floor.is_active ? 'Deactivate' : 'Reactivate'}
              </ActionButton>
              <ActionButton
                color="error"
                onClick={() =>
                  window.confirm(`Delete floor ${floor.floor_number} and its seats?`) && rowAction.act(() => deleteFloor(floor.id))
                }
              >
                Delete
              </ActionButton>
            </RowActions>
          </Box>
        </Stack>
      )}

      {floor.seats.length > 0 && <Box sx={{ mt: 1 }}><SeatList seats={floor.seats} run={run} /></Box>}
      <AddSeat floorId={floor.id} run={run} />
    </Paper>
  );
}

function AddFloor({ buildingId, run }) {
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const { act, fields, general } = useLocalAction(run);
  const submit = async (e) => {
    e.preventDefault();
    if (await act(() => createFloor({ building_id: buildingId, floor_number: Number(number), name: blankToNull(name) }))) {
      setNumber('');
      setName('');
    }
  };
  return (
    <Stack component="form" onSubmit={submit} direction={{ xs: 'column', sm: 'row' }} spacing={1}
      sx={{ alignItems: { sm: 'flex-end' } }}>
      <Field type="number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="No."
        errorText={fields.floor_number || general} sx={{ width: { sm: 160 } }}
        slotProps={{ htmlInput: { 'aria-label': 'New floor number' } }} />
      <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Third Floor - Sales"
        errorText={fields.name} sx={{ flex: 1 }}
        slotProps={{ htmlInput: { 'aria-label': 'New floor name', maxLength: 100 } }} />
      <Button type="submit" variant="contained" startIcon={<AddIcon />} disabled={number === ''} sx={{ flexShrink: 0 }}>
        Add floor
      </Button>
    </Stack>
  );
}

/* ------------------------------------------------------------ page */

export default function Facilities() {
  const [tree, setTree] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('view'); // view | new | edit
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);

  // State is set in promise callbacks, so calling load() from an effect is safe.
  const load = useCallback(
    () => getFacilitiesTree()
      .then((data) => {
        setTree(data);
        setSelectedId((id) => (data.some((b) => b.id === id) ? id : data[0]?.id ?? null));
      })
      .catch((err) => setLoadError(err.message)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Every change reloads the tree so counts and states stay accurate. Errors are
  // re-thrown to the part of the page that made the change (useLocalAction), which
  // shows them beside its own fields or buttons.
  const run = useCallback(
    async (fn) => {
      setBusy(true);
      try {
        const result = await fn();
        await load();
        return result ?? true;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );
  const newBuilding = useLocalAction(run);
  const editBuilding = useLocalAction(run);
  const buildingAction = useLocalAction(run);

  const building = tree?.find((b) => b.id === selectedId);

  const select = (id) => {
    setSelectedId(id);
    setMode('view');
    buildingAction.clear();
  };

  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-start' }, mb: 3 }}>
        <Box>
          <Typography variant="h1">Facilities</Typography>
          <Typography color="text.secondary">
            Buildings, floors and seats that employees can pick when reporting an incident.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} sx={{ flexShrink: 0 }}
          onClick={() => { setMode('new'); newBuilding.clear(); }}>
          Add building
        </Button>
      </Stack>

      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
      {!tree && !loadError && <Typography color="text.secondary">Loading facilities…</Typography>}

      {tree && (
        <Grid container spacing={3} sx={{ opacity: busy ? 0.7 : 1, transition: 'opacity 0.2s' }}>
          <Grid size={{ xs: 12, md: 4 }}>
            <Section title={`Buildings (${tree.length})`}>
              {tree.length ? (
                <List disablePadding>
                  {tree.map((b) => {
                    const floors = b.floors.filter((f) => f.is_active).length;
                    const seats = b.floors.reduce((n, f) => n + f.seats.filter((s) => s.is_active).length, 0);
                    return (
                      <ListItemButton
                        key={b.id}
                        selected={b.id === selectedId && mode !== 'new'}
                        onClick={() => select(b.id)}
                        sx={{ borderRadius: 1, mb: 0.5, ...inactiveSx(b.is_active) }}
                      >
                        <ListItemText
                          primary={<><Box component="span" sx={{ ...mono, fontSize: 12, mr: 0.5 }}>{b.code}</Box> {b.name}</>}
                          secondary={`${plural(floors, 'floor')} · ${plural(seats, 'seat')}${b.is_active ? '' : ' · inactive'}`}
                        />
                      </ListItemButton>
                    );
                  })}
                </List>
              ) : (
                <Typography color="text.secondary">No buildings yet. Add the first one.</Typography>
              )}
            </Section>
          </Grid>

          <Grid size={{ xs: 12, md: 8 }}>
            {mode === 'new' && (
              <Section title="New building">
                <BuildingForm
                  serverErrors={newBuilding.fields}
                  error={newBuilding.general}
                  busy={busy}
                  submitLabel="Create building"
                  onCancel={() => setMode('view')}
                  onSubmit={async (body) => {
                    const created = await newBuilding.act(() => createBuilding(body));
                    if (created) {
                      setSelectedId(created.id);
                      setMode('view');
                    }
                  }}
                />
              </Section>
            )}

            {mode !== 'new' && building && (
              <Section
                title={
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Box component="span" sx={{ ...mono, fontSize: 14, color: 'text.secondary' }}>{building.code}</Box>
                    {building.name}
                    <ActiveTag active={building.is_active} />
                  </Box>
                }
                aside={
                  mode === 'view' && (
                    <Box>
                      <ErrorText alert>{buildingAction.general}</ErrorText>
                      <Stack direction="row" spacing={1} role="group" aria-label="Building actions" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                        <Button size="small" variant="outlined" color="inherit"
                          onClick={() => { editBuilding.clear(); setMode('edit'); }}>Edit</Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="inherit"
                          onClick={() => buildingAction.act(() => updateBuilding(building.id, { is_active: !building.is_active }))}
                        >
                          {building.is_active ? 'Deactivate' : 'Reactivate'}
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={() =>
                            window.confirm(`Delete ${building.name} with all its floors and seats?`) &&
                            buildingAction.act(() => deleteBuilding(building.id))
                          }
                        >
                          Delete
                        </Button>
                      </Stack>
                    </Box>
                  )
                }
              >
                {mode === 'edit' ? (
                  <BuildingForm
                    key={building.id}
                    serverErrors={editBuilding.fields}
                    error={editBuilding.general}
                    busy={busy}
                    initial={building}
                    submitLabel="Save changes"
                    onCancel={() => setMode('view')}
                    onSubmit={async (body) => {
                      if (await editBuilding.act(() => updateBuilding(building.id, body))) setMode('view');
                    }}
                  />
                ) : (
                  <>
                    {(building.address || building.city || building.country) && (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {[building.address, building.city, building.country].filter(Boolean).join(', ')}
                      </Typography>
                    )}
                    {!building.is_active && (
                      <Alert severity="info" role="status" sx={{ mb: 2 }}>
                        Inactive buildings are hidden from the report form. Existing incidents keep their location.
                      </Alert>
                    )}
                    {building.floors.length ? (
                      building.floors.map((f) => <FloorBlock key={f.id} floor={f} run={run} />)
                    ) : (
                      <Typography color="text.secondary" sx={{ mb: 2 }}>No floors yet.</Typography>
                    )}
                    <Card variant="outlined" sx={{ bgcolor: 'action.hover', borderStyle: 'dashed' }}>
                      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                        <AddFloor buildingId={building.id} run={run} />
                      </CardContent>
                    </Card>
                  </>
                )}
              </Section>
            )}

            <Typography variant="body2" color="text.secondary">
              Deleting only works while no incident uses the building, floor or seat. Otherwise deactivate it: it
              disappears from the report form but stays on existing incidents.
            </Typography>
          </Grid>
        </Grid>
      )}
    </>
  );
}
