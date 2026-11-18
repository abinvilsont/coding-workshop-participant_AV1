import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, LinearProgress, Link, Paper, Stack, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Section, StatCard, StatusBadge } from '../components/Badges';
import IncidentTable from '../components/IncidentTable';
import useAction from '../hooks/useAction';
import { useIsCompact, useIsPhone } from '../hooks/useResponsive';
import { setMyAvailability } from '../services/adminService';
import { getDashboard } from '../services/incidentService';
import { AVAILABILITY_LABELS, STATUS_LABELS, categoryLabel, sumCounts } from '../utils/format';

const AVAILABILITY_COLORS = { available: 'success', busy: 'warning', on_leave: 'default', offline: 'default' };

/** Row of stat cards: 2 per row on phones, all in one row on wider screens. */
function StatGrid({ children, columns }) {
  const isPhone = useIsPhone();
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        mb: 3,
        gridTemplateColumns: isPhone ? 'repeat(2, minmax(0, 1fr))' : `repeat(${columns}, minmax(0, 1fr))`,
      }}
    >
      {children}
    </Box>
  );
}

function EmployeeView({ data }) {
  const c = data.status_counts;
  return (
    <>
      <StatGrid columns={4}>
        <StatCard label="Waiting for engineer" value={sumCounts(c, ['open', 'assigned'])} tone="info" />
        <StatCard label="Being worked on" value={sumCounts(c, ['in_progress', 'on_hold'])} tone="warning" />
        <StatCard label="Resolved" value={sumCounts(c, ['resolved', 'closed'])} tone="success" />
        <StatCard label="Total reported" value={sumCounts(c, Object.keys(STATUS_LABELS))} />
      </StatGrid>
      <Section title="My incidents">
        <IncidentTable
          incidents={data.incidents}
          columns={['engineer']}
          empty="You haven't reported any incidents yet."
        />
      </Section>
    </>
  );
}

const AVAILABILITY_HINTS = {
  available: 'You can receive new assignments.',
  busy: 'Admins can still assign you, but will see you are busy.',
  on_leave: 'Admins can’t assign you new tickets while you are on leave.',
  offline: 'Admins can’t assign you new tickets while you are offline.',
};

function AvailabilitySwitch({ value, onChanged }) {
  const { run, busy, error } = useAction();
  return (
    <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }} aria-labelledby="avail-label">
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}>
        <Box>
          <Typography variant="h2" component="h2" id="avail-label">My availability</Typography>
          <Typography variant="body2" color="text.secondary">{AVAILABILITY_HINTS[value]}</Typography>
        </Box>
        <Stack direction="row" role="radiogroup" aria-labelledby="avail-label" sx={{ flexWrap: 'wrap', gap: 1 }}>
          {Object.entries(AVAILABILITY_LABELS).map(([v, label]) => {
            const on = v === value;
            return (
              <Button
                key={v}
                role="radio"
                aria-checked={on}
                size="small"
                variant={on ? 'contained' : 'outlined'}
                color={on && AVAILABILITY_COLORS[v] !== 'default' ? AVAILABILITY_COLORS[v] : 'inherit'}
                disabled={busy}
                onClick={() => !on && run(() => setMyAvailability(v)).then((ok) => ok && onChanged())}
              >
                {label}
              </Button>
            );
          })}
        </Stack>
      </Stack>
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
    </Paper>
  );
}

function EngineerView({ data, reload }) {
  const c = data.status_counts;
  const p = data.profile;
  return (
    <>
      {p && <AvailabilitySwitch value={p.availability} onChanged={reload} />}
      <StatGrid columns={4}>
        <StatCard label="New assignments" value={c.assigned ?? 0} tone="info" />
        <StatCard label="In progress" value={c.in_progress ?? 0} tone="warning" />
        <StatCard label="On hold" value={c.on_hold ?? 0} />
        <StatCard
          label="Capacity"
          value={p ? `${p.active_tickets}/${p.max_active_tickets}` : '–'}
          tone={p && p.remaining_capacity <= 0 ? 'danger' : 'success'}
          hint={
            p
              ? `${AVAILABILITY_LABELS[p.availability]} · ${p.specializations.map(categoryLabel).join(', ')}`
              : 'No engineer profile'
          }
        />
      </StatGrid>
      <Section title="My tickets">
        <IncidentTable
          incidents={data.incidents}
          columns={['reporter']}
          empty="No tickets assigned to you right now."
        />
      </Section>
    </>
  );
}

function Workload({ engineers }) {
  if (!engineers.length) {
    return <Typography color="text.secondary">No engineer profiles yet.</Typography>;
  }
  return (
    <Stack component="ul" spacing={2} sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {engineers.map((e) => {
        const pct = Math.min(100, Math.round((e.active_tickets / e.max_active_tickets) * 100));
        return (
          <li key={e.id}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography sx={{ fontWeight: 600 }}>{e.name}</Typography>
              <Chip
                size="small"
                label={AVAILABILITY_LABELS[e.availability]}
                color={AVAILABILITY_COLORS[e.availability]}
                variant={e.availability === 'available' ? 'filled' : 'outlined'}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">{e.specializations.map(categoryLabel).join(', ')}</Typography>
            <LinearProgress
              variant="determinate"
              value={pct}
              color={pct >= 100 ? 'error' : 'primary'}
              aria-label={`${e.active_tickets} of ${e.max_active_tickets} tickets`}
              sx={{ height: 8, borderRadius: 4, my: 0.75 }}
            />
            <Typography variant="body2" color="text.secondary">
              {e.active_tickets} of {e.max_active_tickets} active tickets
            </Typography>
          </li>
        );
      })}
    </Stack>
  );
}

function AdminView({ data }) {
  const compact = useIsCompact();
  const c = data.status_counts;
  const a = data.attention;
  const f = data.facilities;
  return (
    <>
      <StatGrid columns={5}>
        <StatCard label="Unassigned" value={a.unassigned} tone={a.unassigned ? 'danger' : 'success'} />
        <StatCard label="Escalated" value={a.escalated} tone={a.escalated ? 'danger' : 'success'} />
        <StatCard
          label="Priority requests"
          value={a.priority_requests}
          tone={a.priority_requests ? 'warning' : 'success'}
        />
        <StatCard label="Awaiting closure" value={a.awaiting_closure} tone="info" />
        <StatCard label="Active tickets" value={sumCounts(c, ['assigned', 'in_progress', 'on_hold'])} />
      </StatGrid>

      <Section title="Needs attention">
        <IncidentTable
          incidents={data.needs_attention}
          columns={['reporter', 'engineer']}
          empty="Nothing needs your attention right now."
        />
      </Section>

      <Box sx={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', columnGap: 3 }}>
        <Section title="Engineer workload">
          <Workload engineers={data.engineers} />
        </Section>

        <Section title="Facilities">
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.5, mb: 3 }}>
            <StatCard label="Buildings" value={f.buildings} />
            <StatCard label="Floors" value={f.floors} />
            <StatCard label="Seats" value={f.seats} />
          </Box>
          <Typography variant="h3" component="h3" sx={{ mb: 1 }}>Tickets by status</Typography>
          <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {Object.keys(STATUS_LABELS).map((s) => (
              <Stack component="li" key={s} direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <StatusBadge status={s} />
                <Typography component="span" sx={{ fontWeight: 600 }}>{c[s] ?? 0}</Typography>
              </Stack>
            ))}
          </Stack>
        </Section>
      </Box>

      <Section title="Recently updated" aside={<Link href="#/incidents" underline="hover">View all →</Link>}>
        <IncidentTable
          incidents={data.incidents}
          columns={['reporter', 'engineer']}
          empty="No incidents yet."
        />
      </Section>
    </>
  );
}

const VIEWS = { employee: EmployeeView, engineer: EngineerView, facility_admin: AdminView };

const SUBTITLES = {
  employee: 'Track the issues you have reported.',
  engineer: 'Your assigned tickets, highest priority first.',
  facility_admin: 'Overview of all incidents, engineers and facilities.',
};

export default function Dashboard({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // State is set in promise callbacks, so calling this from an effect is safe.
  const fetchDashboard = useCallback(
    () => getDashboard()
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const load = () => {
    setLoading(true);
    fetchDashboard();
  };

  const View = VIEWS[user.role];
  const firstName = user.name?.split(' ')[0] ?? '';

  return (
    <>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-end' }, mb: 3 }}
      >
        <Box>
          <Typography variant="h1" component="h1">Hello, {firstName}</Typography>
          <Typography color="text.secondary">{SUBTITLES[user.role]}</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" color="inherit" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} href="#/incidents/new">Report incident</Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!data && loading && <LinearProgress aria-label="Loading dashboard…" sx={{ mb: 2 }} />}
      {data && View && <View data={data} reload={load} />}
    </>
  );
}
