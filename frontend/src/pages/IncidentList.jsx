import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, FormControlLabel, InputAdornment, Stack, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { Section } from '../components/Badges';
import IncidentTable from '../components/IncidentTable';
import { useIsPhone } from '../hooks/useResponsive';
import { listIncidents } from '../services/incidentService';
import { PRIORITIES, STATUS_LABELS, titleCase } from '../utils/format';

const PAGE_SIZE = 25;

const HEADINGS = {
  employee: ['My incidents', 'Everything you have reported.'],
  engineer: ['My tickets', 'Incidents assigned to you.'],
  facility_admin: ['All incidents', 'Every incident across all facilities.'],
};

const NATIVE = { select: { native: true }, inputLabel: { shrink: true } };

export default function IncidentList({ user }) {
  const isPhone = useIsPhone();
  const [filters, setFilters] = useState({ status: '', priority: '', q: '', escalated: false, unassigned: false });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  // The last finished request: which query it answered, and its result or error.
  // Loading is derived: true until a response for the current query arrives.
  const [response, setResponse] = useState({ query: null, result: null, error: '' });

  // Debounce the search box
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ({ ...f, q: search }));
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => ({
    status: filters.status || undefined,
    priority: filters.priority || undefined,
    q: filters.q.trim() || undefined,
    escalated: filters.escalated || undefined,
    unassigned: filters.unassigned || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [filters, page]);

  useEffect(() => {
    let cancelled = false;
    listIncidents(query)
      .then((r) => !cancelled && setResponse({ query, result: r, error: '' }))
      .catch((err) => !cancelled && setResponse((prev) => ({ ...prev, query, error: err.message })));
    return () => {
      cancelled = true;
    };
  }, [query]);

  const loading = response.query !== query;
  const result = response.result; // the previous page stays visible while the next one loads
  const error = loading ? '' : response.error;

  const update = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setFilters((f) => ({ ...f, [field]: value }));
    setPage(0);
  };

  const [title, subtitle] = HEADINGS[user.role] ?? HEADINGS.employee;
  const isAdmin = user.role === 'facility_admin';
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-end' }, mb: 3 }}
      >
        <Box>
          <Typography variant="h1" component="h1">{title}</Typography>
          <Typography color="text.secondary">{subtitle}</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} href="#/incidents/new" sx={{ alignSelf: { xs: 'flex-start', sm: 'auto' } }}>
          Report incident
        </Button>
      </Stack>

      {/* Filters: one column on phones, one row on wider screens */}
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          alignItems: 'center',
          mb: 2,
          gridTemplateColumns: isPhone ? 'minmax(0, 1fr)' : 'minmax(200px, 2fr) repeat(2, minmax(140px, 1fr)) auto',
        }}
      >
        <TextField
          type="search"
          placeholder="Search title or INC-…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': 'Search incidents' },
            input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
          }}
          sx={{ bgcolor: 'background.paper' }}
        />
        <TextField select label="Status" value={filters.status} onChange={update('status')} slotProps={NATIVE} sx={{ bgcolor: 'background.paper' }}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </TextField>
        <TextField select label="Priority" value={filters.priority} onChange={update('priority')} slotProps={NATIVE} sx={{ bgcolor: 'background.paper' }}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{titleCase(p)}</option>
          ))}
        </TextField>
        <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
          <FormControlLabel
            control={<Checkbox size="small" checked={filters.escalated} onChange={update('escalated')} />}
            label="Escalated"
          />
          {isAdmin && (
            <FormControlLabel
              control={<Checkbox size="small" checked={filters.unassigned} onChange={update('unassigned')} />}
              label="Unassigned"
            />
          )}
        </Stack>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Section
        title={result ? `${total} incident${total === 1 ? '' : 's'}` : 'Incidents'}
        aside={loading && <Typography variant="body2" color="text.secondary">Loading…</Typography>}
      >
        {result && (
          <IncidentTable
            incidents={result.items}
            columns={user.role === 'employee' ? ['engineer'] : ['reporter', 'engineer']}
            empty="No incidents match these filters."
          />
        )}
        {pages > 1 && (
          <Stack direction="row" spacing={2} sx={{ justifyContent: 'center', alignItems: 'center', mt: 2 }}>
            <Button variant="outlined" color="inherit" disabled={page === 0} onClick={() => setPage(page - 1)}>
              ← Previous
            </Button>
            <Typography variant="body2" color="text.secondary">Page {page + 1} of {pages}</Typography>
            <Button variant="outlined" color="inherit" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
              Next →
            </Button>
          </Stack>
        )}
      </Section>
    </>
  );
}
