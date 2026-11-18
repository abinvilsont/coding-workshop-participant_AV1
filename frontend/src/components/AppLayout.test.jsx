import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context as ResponsiveContext } from 'react-responsive';
import { describe, expect, it, vi } from 'vitest';
import { USERS, incident, mockApi } from '../test/mockApi';
import AppLayout from './AppLayout';
import IncidentTable from './IncidentTable';

const phone = (ui) => <ResponsiveContext.Provider value={{ width: 390 }}>{ui}</ResponsiveContext.Provider>;

describe('AppLayout', () => {
  it('desktop: shows the nav, user and sign out in the top bar, marking the current page', () => {
    mockApi({ 'GET /notifications/unread-count': { unread_count: 0 } });
    render(<AppLayout user={USERS.admin} path="/incidents" onLogout={() => {}}>page</AppLayout>);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Incidents' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Engineers' })).toBeInTheDocument();
    expect(screen.getByText('Facility Admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument();
  });

  it('phone: collapses the nav and sign out into a menu', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    mockApi({ 'GET /notifications/unread-count': { unread_count: 0 } });
    render(phone(<AppLayout user={USERS.employee} path="/" onLogout={onLogout}>page</AppLayout>));

    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Report incident' })).toBeInTheDocument();
    expect(nav).not.toHaveTextContent('Facilities');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onLogout).toHaveBeenCalled();
  });
});

describe('IncidentTable', () => {
  const rows = [incident({ id: 4, title: 'AC not cooling', is_escalated: true, assigned_engineer: null })];

  it('desktop: renders a table with optional columns', () => {
    render(<IncidentTable incidents={rows} columns={['reporter', 'engineer']} empty="None" />);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Engineer' })).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'AC not cooling' })).toHaveAttribute('href', '#/incidents/4');
    expect(within(table).getByText('Unassigned')).toBeInTheDocument();
    expect(within(table).getByText('Escalated')).toBeInTheDocument();
  });

  it('phone: renders one card per incident instead of a table', () => {
    render(phone(<IncidentTable incidents={rows} columns={['engineer']} empty="None" />));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Incidents' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByRole('link', { name: 'AC not cooling' })).toBeInTheDocument();
    expect(list).toHaveTextContent('Unassigned · Updated');
  });

  it('shows the empty message', () => {
    render(<IncidentTable incidents={[]} empty="No incidents yet." />);
    expect(screen.getByText('No incidents yet.')).toBeInTheDocument();
  });
});
