import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, FormControlLabel, Link, Stack, Switch, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { Section } from '../../components/Badges';
import Field, { ErrorText } from '../../components/Field';
import { useIsCompact } from '../../hooks/useResponsive';
import { listUsers, updateUser } from '../../services/adminService';
import { getFacilities } from '../../services/incidentService';
import { ROLE_LABELS, formatDateTime, timeAgo } from '../../utils/format';

const ROLE_COLORS = { facility_admin: 'primary', engineer: 'secondary', employee: 'default' };

function RoleChip({ role }) {
  return <Chip size="small" variant="outlined" color={ROLE_COLORS[role] ?? 'default'} label={ROLE_LABELS[role] ?? role} />;
}

/** What an admin can do to one account; errors show right above these buttons. */
function PersonActions({ person, me, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (person.id === me.id) {
    return <Typography variant="body2" color="text.secondary">You</Typography>;
  }
  if (person.role === 'engineer') {
    return <Link href="#/admin/engineers" variant="body2">Manage on Engineers</Link>;
  }

  const change = async (body, question) => {
    if (question && !window.confirm(question)) return;
    setBusy(true);
    setError('');
    try {
      onChanged(await updateUser(person.id, body));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const admin = person.role === 'facility_admin';

  return (
    <Box>
      <ErrorText alert>{error}</ErrorText>
      <Stack direction="row" spacing={0.5} role="group" aria-label={`${person.name} actions`}
        sx={{ flexWrap: 'wrap', justifyContent: { sm: 'flex-end' } }}>
        {person.is_active && (
          <Button size="small" disabled={busy}
            onClick={() => change(
              { role: admin ? 'employee' : 'facility_admin' },
              admin
                ? `Make ${person.name} an Employee? They lose access to admin pages.`
                : `Make ${person.name} a Facility Admin? They can then manage everything, including people.`,
            )}>
            {admin ? 'Make employee' : 'Make admin'}
          </Button>
        )}
        <Button size="small" color={person.is_active ? 'error' : 'primary'} disabled={busy}
          onClick={() => change(
            { is_active: !person.is_active },
            person.is_active ? `Deactivate ${person.name}? They are signed out and can't sign in again.` : null,
          )}>
          {person.is_active ? 'Deactivate' : 'Reactivate'}
        </Button>
      </Stack>
    </Box>
  );
}

/**
 * The person's usual building: the report form starts on it. Saves as soon as it's
 * picked; a problem shows right above the picker. Engineers have theirs on the Engineers page.
 */
function BuildingPicker({ person, buildings, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (person.role === 'engineer') {
    return <Typography variant="body2" color="text.secondary">—</Typography>;
  }
  // A deactivated building stays visible while someone still has it
  const options = buildings?.some((b) => b.id === person.home_building_id) || !person.home_building_id
    ? buildings ?? []
    : [...(buildings ?? []), { id: person.home_building_id, name: `${person.home_building} (inactive)` }];

  const change = async (e) => {
    const value = e.target.value === '' ? null : Number(e.target.value);
    setBusy(true);
    setError('');
    try {
      const updated = await updateUser(person.id, { home_building_id: value });
      onChanged(updated, updated.home_building
        ? `${updated.name}'s usual building is now ${updated.home_building}.`
        : `${updated.name} no longer has a usual building.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field
      select
      size="small"
      value={person.home_building_id ?? ''}
      onChange={change}
      disabled={!buildings || busy}
      errorText={error}
      sx={{ minWidth: 170 }}
      slotProps={{ select: { native: true }, htmlInput: { 'aria-label': `${person.name}'s usual building` } }}
    >
      <option value="">Not set</option>
      {options.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </Field>
  );
}

const lastSeen = (p) => (p.last_login_at
  ? <span title={formatDateTime(p.last_login_at)}>{timeAgo(p.last_login_at)}</span>
  : <Typography component="span" variant="body2" color="text.secondary">Never</Typography>);

function NameCell({ person }) {
  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography sx={{ fontWeight: 700 }}>{person.name}</Typography>
        {!person.is_active && <Chip label="Inactive" size="small" sx={{ height: 20, fontSize: 11 }} />}
      </Stack>
      <Typography variant="body2" color="text.secondary">{person.email}</Typography>
    </>
  );
}

function PeopleTable({ people, me, buildings, onChanged }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Person</TableCell>
            <TableCell>Role</TableCell>
            <TableCell>Department</TableCell>
            <TableCell>Usual building</TableCell>
            <TableCell>Last sign-in</TableCell>
            <TableCell aria-label="Actions" />
          </TableRow>
        </TableHead>
        <TableBody>
          {people.map((p) => (
            <TableRow key={p.id} hover sx={{ opacity: p.is_active ? 1 : 0.6 }}>
              <TableCell><NameCell person={p} /></TableCell>
              <TableCell><RoleChip role={p.role} /></TableCell>
              <TableCell sx={{ fontSize: 13 }}>{p.department ?? '—'}</TableCell>
              <TableCell><BuildingPicker person={p} buildings={buildings} onChanged={onChanged} /></TableCell>
              <TableCell sx={{ fontSize: 13 }}>{lastSeen(p)}</TableCell>
              <TableCell align="right"><PersonActions person={p} me={me} onChanged={onChanged} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function PeopleCards({ people, me, buildings, onChanged }) {
  return (
    <Stack component="ul" spacing={1.5} aria-label="People" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {people.map((p) => (
        <Card key={p.id} component="li" sx={{ opacity: p.is_active ? 1 : 0.6 }}>
          <CardContent sx={{ '&:last-child': { pb: 2 } }}>
            <NameCell person={p} />
            <Stack direction="row" spacing={1} alignItems="center" sx={{ my: 1 }}>
              <RoleChip role={p.role} />
              <Typography variant="caption" color="text.secondary">Last sign-in {lastSeen(p)}</Typography>
            </Stack>
            {p.role !== 'engineer' && (
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.5 }}>
                  Usual building
                </Typography>
                <BuildingPicker person={p} buildings={buildings} onChanged={onChanged} />
              </Box>
            )}
            <PersonActions person={p} me={me} onChanged={onChanged} />
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

/**
 * Facility Admin: everyone with an account; promote employees to admin, (de)activate
 * accounts, and set each person's usual building.
 */
export default function People({ user }) {
  const isPhone = useIsCompact();
  const [people, setPeople] = useState(null);
  const [buildings, setBuildings] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  useEffect(() => {
    getFacilities().then(setBuildings).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    // Wait for a pause in typing before searching
    const timer = setTimeout(() => {
      listUsers({ role, includeInactive, q: q.trim() })
        .then((data) => {
          setPeople(data.items);
          setError('');
        })
        .catch((err) => setError(err.message));
    }, q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [q, role, includeInactive]);

  const changed = (updated, message) => {
    setPeople((list) => list
      .map((p) => (p.id === updated.id ? updated : p))
      .filter((p) => includeInactive || p.is_active));
    setNotice(
      message ?? (updated.is_active
        ? `${updated.name} is now ${updated.role === 'facility_admin' ? 'a Facility Admin' : 'an Employee'}.`
        : `${updated.name} is deactivated.`),
    );
  };

  return (
    <>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h1">People</Typography>
        <Typography color="text.secondary">
          Everyone with an account. Set someone's usual building (their reports start on it), make an employee a
          Facility Admin, or deactivate an account. Engineers are managed on
          the <Link href="#/admin/engineers">Engineers</Link> page.
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" role="status" sx={{ mb: 2 }}>{notice}</Alert>}

      <Section
        title={people ? `${people.length} ${people.length === 1 ? 'person' : 'people'}` : 'People'}
        aside={
          <FormControlLabel
            control={<Switch checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />}
            label="Show inactive"
          />
        }
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
          <Field label="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
          <Field select label="Role" value={role} onChange={(e) => setRole(e.target.value)} sx={{ minWidth: { sm: 200 } }}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
            <option value="">Everyone</option>
            <option value="employee">Employees</option>
            <option value="facility_admin">Facility Admins</option>
            <option value="engineer">Engineers</option>
          </Field>
        </Stack>
        {!people ? (
          <Typography color="text.secondary">Loading people…</Typography>
        ) : people.length === 0 ? (
          <Typography color="text.secondary">Nobody matches.</Typography>
        ) : isPhone ? (
          <PeopleCards people={people} me={user} buildings={buildings} onChanged={changed} />
        ) : (
          <PeopleTable people={people} me={user} buildings={buildings} onChanged={changed} />
        )}
      </Section>
    </>
  );
}
