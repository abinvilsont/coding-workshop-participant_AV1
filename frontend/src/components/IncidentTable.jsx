import {
  Card, CardContent, Link, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { useIsPhone } from '../hooks/useResponsive';
import { categoryLabel, locationText, timeAgo } from '../utils/format';
import { EscalatedBadge, PriorityBadge, StatusBadge } from './Badges';

function Title({ incident: i }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
        {i.reference}
      </Typography>
      <Link href={`#/incidents/${i.id}`} underline="hover" sx={{ fontWeight: 600 }}>{i.title}</Link>
      {i.is_escalated && <EscalatedBadge />}
    </Stack>
  );
}

const meta = (i) => `${categoryLabel(i.category)} · ${locationText(i)}`;

/** Phone: one card per incident instead of a wide table. */
function IncidentCards({ incidents, columns }) {
  return (
    <Stack spacing={1.5} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label="Incidents">
      {incidents.map((i) => (
        <Card key={i.id} component="li">
          <CardContent sx={{ '&:last-child': { pb: 2 } }}>
            <Title incident={i} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{meta(i)}</Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
              <StatusBadge status={i.status} />
              <PriorityBadge priority={i.priority} requested={i.requested_priority} />
            </Stack>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
              {columns.includes('reporter') && `${i.reported_by} · `}
              {columns.includes('engineer') && `${i.assigned_engineer ?? 'Unassigned'} · `}
              Updated {timeAgo(i.updated_at)}
            </Typography>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

export default function IncidentTable({ incidents, columns = [], empty }) {
  const isPhone = useIsPhone();
  if (!incidents?.length) {
    return <Typography color="text.secondary" sx={{ py: 2 }}>{empty}</Typography>;
  }
  if (isPhone) return <IncidentCards incidents={incidents} columns={columns} />;
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Incident</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Priority</TableCell>
            {columns.includes('reporter') && <TableCell>Reported by</TableCell>}
            {columns.includes('engineer') && <TableCell>Engineer</TableCell>}
            <TableCell>Updated</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {incidents.map((i) => (
            <TableRow key={i.id} hover>
              <TableCell sx={{ py: 1.25 }}>
                <Title incident={i} />
                <Typography variant="body2" color="text.secondary">{meta(i)}</Typography>
              </TableCell>
              <TableCell><StatusBadge status={i.status} /></TableCell>
              <TableCell><PriorityBadge priority={i.priority} requested={i.requested_priority} /></TableCell>
              {columns.includes('reporter') && <TableCell>{i.reported_by}</TableCell>}
              {columns.includes('engineer') && (
                <TableCell>
                  {i.assigned_engineer ?? <Typography component="span" color="text.secondary">Unassigned</Typography>}
                </TableCell>
              )}
              <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }} title={new Date(i.updated_at).toLocaleString()}>
                {timeAgo(i.updated_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
