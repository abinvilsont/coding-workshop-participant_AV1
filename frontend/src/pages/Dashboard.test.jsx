import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { theme } from '../theme';
import { USERS, mockApi } from '../test/mockApi';
import Dashboard from './Dashboard';

const ROW = {
  id: 4, reference: 'INC-000004', title: 'Air conditioning not cooling', category: 'hvac', priority: 'medium',
  status: 'in_progress', requested_priority: null, is_escalated: false, updated_at: new Date().toISOString(),
  building: 'ACME Headquarters', floor: 'First Floor', seat: '1A-001', location_details: null,
  reported_by: 'Emma Employee', assigned_engineer: 'Ethan Electrics',
};

// A stat card: its label paragraph's card, and the big number inside it
const stat = (label) => screen.getAllByText(label, { selector: 'p' })
  .map((el) => el.closest('.MuiCard-root')).find(Boolean);
const statValue = (label) => within(stat(label)).getByText(/\S/, { selector: 'p.MuiTypography-h4' });

describe('Dashboard', () => {
  it('employee: status summary and own incidents', async () => {
    mockApi({ 'GET /dashboard': { role: 'employee', status_counts: { in_progress: 1, closed: 1 }, incidents: [ROW] } });
    render(<Dashboard user={USERS.employee} />);

    expect(await screen.findByRole('link', { name: 'Air conditioning not cooling' })).toHaveAttribute('href', '#/incidents/4');
    expect(screen.getByRole('heading', { name: 'Hello, Emma' })).toBeInTheDocument();
    expect(stat('Being worked on')).toHaveTextContent('1');
    expect(stat('Total reported')).toHaveTextContent('2');
  });

  it('employee with nothing reported sees an empty state', async () => {
    mockApi({ 'GET /dashboard': { role: 'employee', status_counts: {}, incidents: [] } });
    render(<Dashboard user={USERS.employee} />);
    expect(await screen.findByText("You haven't reported any incidents yet.")).toBeInTheDocument();
  });

  it('engineer: capacity and availability switch', async () => {
    const user = userEvent.setup();
    let availability = 'available';
    const api = mockApi({
      'GET /dashboard': () => ({
        role: 'engineer', status_counts: { in_progress: 1 }, incidents: [ROW],
        profile: { availability, max_active_tickets: 5, active_tickets: 1, remaining_capacity: 4, specializations: ['hvac', 'electrical'] },
      }),
      'PATCH /engineers/me/availability': (body) => { availability = body.availability; return {}; },
    });
    render(<Dashboard user={USERS.engineer} />);

    expect(await screen.findByText('1/5')).toBeInTheDocument();
    expect(stat('Capacity')).toHaveTextContent('Available · HVAC, Electrical');
    const group = screen.getByRole('radiogroup', { name: 'My availability' });
    expect(within(group).getByRole('radio', { name: 'Available' })).toHaveAttribute('aria-checked', 'true');

    await user.click(within(group).getByRole('radio', { name: 'On leave' }));
    expect(await within(group).findByRole('radio', { name: 'On leave', checked: true })).toBeInTheDocument();
    expect(screen.getByText(/can’t assign you new tickets while you are on leave/)).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'PATCH').body).toEqual({ availability: 'on_leave' });
  });

  it('admin: attention counts, workload and facilities', async () => {
    mockApi({
      'GET /dashboard': {
        role: 'facility_admin',
        status_counts: { open: 1, assigned: 1, in_progress: 1, on_hold: 1, resolved: 1, closed: 1, cancelled: 1 },
        attention: { unassigned: 1, escalated: 1, priority_requests: 1, awaiting_closure: 1 },
        facilities: { buildings: 2, floors: 5, seats: 9 },
        engineers: [{ id: 2, name: 'Ethan Electrics', availability: 'available', specializations: ['hvac'],
                      active_tickets: 5, max_active_tickets: 5, remaining_capacity: 0 }],
        needs_attention: [{ ...ROW, id: 7, reference: 'INC-000007', title: 'Wi-Fi drops', is_escalated: true,
                            requested_priority: 'critical', priority: 'high', assigned_engineer: null }],
        incidents: [ROW],
      },
    });
    render(<ThemeProvider theme={theme}><Dashboard user={USERS.admin} /></ThemeProvider>);

    expect(await screen.findByRole('link', { name: 'Wi-Fi drops' })).toBeInTheDocument();
    expect(statValue('Unassigned')).toHaveStyle({ color: 'rgb(220, 38, 38)' }); // danger tone
    expect(statValue('Escalated')).toHaveStyle({ color: 'rgb(220, 38, 38)' });
    expect(stat('Active tickets')).toHaveTextContent('3');
    const meter = screen.getByRole('progressbar', { name: '5 of 5 tickets' });
    expect(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter).toHaveClass('MuiLinearProgress-colorError'); // full engineer shows red
    expect(stat('Seats')).toHaveTextContent('9');
    const attention = screen.getByRole('region', { name: 'Needs attention' });
    expect(within(attention).getByRole('row', { name: /Wi-Fi drops/ })).toHaveTextContent('Unassigned');
  });

  it('shows load errors and can refresh', async () => {
    const user = userEvent.setup();
    let fail = true;
    mockApi({ 'GET /dashboard': () => (fail ? { status: 500, body: { message: 'Something went wrong. Please try again.' } }
                                            : { role: 'employee', status_counts: {}, incidents: [] }) });
    render(<Dashboard user={USERS.employee} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText("You haven't reported any incidents yet.")).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
