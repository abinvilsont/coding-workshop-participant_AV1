import { Box, Link, Typography } from '@mui/material';
import { Section } from '../components/Badges';
import IncidentForm from '../components/IncidentForm';
import { navigate } from '../router';
import { createIncident } from '../services/incidentService';

export default function NewIncident({ user }) {
  const handleSubmit = async (payload) => {
    const created = await createIncident(payload);
    navigate(`/incidents/${created.id}`);
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
        <IncidentForm
          submitLabel="Submit incident"
          allowCritical={user.role === 'facility_admin'}
          onSubmit={handleSubmit}
          onCancel={() => window.history.back()}
        />
      </Section>
    </>
  );
}
