import { useEffect, useState } from 'react';
import { Box, Link, Typography } from '@mui/material';
import AlreadyReportedDialog from '../components/AlreadyReportedDialog';
import { Section } from '../components/Badges';
import IncidentForm from '../components/IncidentForm';
import { navigate } from '../router';
import { getMe } from '../services/authService';
import { createIncident, findSimilarIncidents } from '../services/incidentService';

export default function NewIncident({ user }) {
  // Set when the report looks like an open incident: { matches, payload }
  const [similar, setSimilar] = useState(null);
  // The reporter's usual building, asked fresh so one an admin has just set applies
  // straight away. undefined = still asking; a failed check just leaves it empty.
  const [usualBuildingId, setUsualBuildingId] = useState(undefined);

  useEffect(() => {
    getMe()
      .then((me) => setUsualBuildingId(me.home_building_id ?? null))
      .catch(() => setUsualBuildingId(null));
  }, []);

  const create = async (payload) => {
    const created = await createIncident(payload);
    navigate(`/incidents/${created.id}`);
  };

  const handleSubmit = async (payload) => {
    if (user.role === 'employee') {
      // A failed check never stops someone reporting
      const matches = await findSimilarIncidents(payload).catch(() => []);
      if (matches.length) {
        setSimilar({ matches, payload });
        return;
      }
    }
    await create(payload);
  };

  return (
    <>
      <Box sx={{ mb: 3 }}>
        <Link href="#/incidents" underline="hover" variant="body2">← Incidents</Link>
        <Typography variant="h1" component="h1" sx={{ mt: 0.5 }}>Report an incident</Typography>
        <Typography color="text.secondary">
          Tell us what's wrong and where. A Facility Admin will assign an engineer.
        </Typography>
      </Box>
      <Section>
        {usualBuildingId === undefined ? (
          <Typography color="text.secondary">Loading…</Typography>
        ) : (
        <IncidentForm
          submitLabel="Submit incident"
          allowCritical={user.role === 'facility_admin'}
          defaultBuildingId={usualBuildingId}
          onSubmit={handleSubmit}
          onCancel={() => window.history.back()}
        />
        )}
      </Section>
      {similar && (
        <AlreadyReportedDialog
          matches={similar.matches}
          category={similar.payload.category}
          onReportAnyway={() => create(similar.payload)}
          onClose={() => setSimilar(null)}
        />
      )}
    </>
  );
}
