import { useId } from 'react';
import { Box, Card, CardContent, Chip, Paper, Stack, Typography } from '@mui/material';
import { PRIORITY_COLORS, STATUS_COLORS, TONE_COLORS, schemeSx } from '../theme';
import { STATUS_LABELS, titleCase } from '../utils/format';

const chipSx = ([color, bgcolor, darkColor, darkBg]) =>
  schemeSx({ color, bgcolor, height: 24 }, { color: darkColor, bgcolor: darkBg });

/** A merged duplicate is stored as cancelled but shown as "Merged". */
export function StatusBadge({ status, merged = false }) {
  if (merged) {
    return <Chip size="small" label="Merged" sx={chipSx(STATUS_COLORS.merged)} />;
  }
  return (
    <Chip
      size="small"
      label={STATUS_LABELS[status] ?? status}
      sx={[
        chipSx(STATUS_COLORS[status] ?? STATUS_COLORS.closed),
        { textDecoration: status === 'cancelled' ? 'line-through' : 'none' },
      ]}
    />
  );
}

export function PriorityBadge({ priority, requested }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" component="span" sx={{ flexWrap: 'wrap' }}>
      <Chip size="small" label={titleCase(priority)} sx={chipSx(PRIORITY_COLORS[priority] ?? PRIORITY_COLORS.low)} />
      {requested && requested !== priority && (
        <Typography component="span" variant="caption" color="warning.dark" title="Priority requested by employee">
          → {titleCase(requested)} requested
        </Typography>
      )}
    </Stack>
  );
}

export function EscalatedBadge() {
  return <Chip size="small" color="error" label="Escalated" sx={{ height: 24 }} />;
}

export function StatCard({ label, value, tone = 'neutral', hint }) {
  const color = TONE_COLORS[tone] ?? tone;
  const colorSx = Array.isArray(color) ? schemeSx({ color: color[0] }, { color: color[1] }) : { color };
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Typography variant="h4" component="p" sx={[{ fontWeight: 700 }, colorSx]}>
          {value}
        </Typography>
        {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
      </CardContent>
    </Card>
  );
}

export function Section({ title, children, aside }) {
  const headingId = useId();
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={title ? headingId : undefined}
      sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}
    >
      {(title || aside) && (
        <Box
          component="header"
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}
        >
          {title && <Typography variant="h2" component="h2" id={headingId}>{title}</Typography>}
          {aside}
        </Box>
      )}
      {children}
    </Paper>
  );
}
