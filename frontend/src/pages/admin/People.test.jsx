import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context as ResponsiveContext } from 'react-responsive';
import { describe, expect, it, vi } from 'vitest';
import { USERS, mockApi } from '../../test/mockApi';
import People from './People';

const person = (o) => ({
  department: null, is_active: true, created_at: '2026-11-01T09:00:00Z', last_login_at: '2026-11-18T09:00:00Z', ...o,
});
const ALICE = person({ id: 1, name: 'Alice Admin', email: 'alice.admin@acme.inc', role: 'facility_admin', department: 'Facilities' });
const TOM = person({ id: 4, name: 'Tom Tech', email: 'tom.eng@acme.inc', role: 'engineer' });
const EMMA = person({ id: 6, name: 'Emma Employee', email: 'emma@acme.inc', role: 'employee', department: 'Finance' });
const LIAM = person({ id: 7, name: 'Liam Lee', email: 'liam.lee@acme.inc', role: 'employee', last_login_at: null });

function backend(extra = {}) {
  let people = [ALICE, TOM, EMMA, LIAM];
  return mockApi({
    'GET /users': () => ({ items: people, total: people.length }),
    'PATCH /users/6': (body) => (people = people.map((p) => (p.id === 6 ? { ...p, ...body } : p))).find((p) => p.id === 6),
    'PATCH /users/7': (body) => ({ ...LIAM, ...body }),
    ...extra,
  });
}

const row = async (name) => (await screen.findByText(name)).closest('tr');

describe('People admin page', () => {
  it('lists everyone with role, department and last sign-in', async () => {
    backend();
    render(<People user={USERS.admin} />);
    expect(await screen.findByRole('heading', { name: '4 people' })).toBeInTheDocument();
    const emma = await row('Emma Employee');
    expect(emma).toHaveTextContent('emma@acme.inc');
    expect(emma).toHaveTextContent('Employee');
    expect(emma).toHaveTextContent('Finance');
    expect(await row('Liam Lee')).toHaveTextContent('Never');
    // yourself: no actions; engineers: managed elsewhere
    expect(await row('Alice Admin')).toHaveTextContent('You');
    expect(within(await row('Alice Admin')).queryByRole('button')).not.toBeInTheDocument();
    expect(within(await row('Tom Tech')).getByRole('link', { name: 'Manage on Engineers' }))
      .toHaveAttribute('href', '#/admin/engineers');
  });

  it('makes an employee an admin after confirming', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = backend();
    render(<People user={USERS.admin} />);
    await user.click(within(await row('Emma Employee')).getByRole('button', { name: 'Make admin' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Make Emma Employee a Facility Admin?'));
    expect(api.calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/users/6', body: { role: 'facility_admin' } });
    expect(await screen.findByRole('status')).toHaveTextContent('Emma Employee is now a Facility Admin.');
    expect(within(await row('Emma Employee')).getByRole('button', { name: 'Make employee' })).toBeInTheDocument();
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const api = backend();
    render(<People user={USERS.admin} />);
    await user.click(within(await row('Emma Employee')).getByRole('button', { name: 'Deactivate' }));
    expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('deactivates an account and hides it unless inactive people are shown', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = backend();
    render(<People user={USERS.admin} />);
    await user.click(within(await row('Liam Lee')).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Liam Lee is deactivated.');
    await waitFor(() => expect(screen.queryByText('Liam Lee')).not.toBeInTheDocument());

    await user.click(screen.getByLabelText('Show inactive'));
    await waitFor(() => expect(api.calls.at(-1).query.get('include_inactive')).toBe('true'));
  });

  it('shows a refusal right above that person’s buttons', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    backend({
      'PATCH /users/6': { status: 409, body: { message: 'There must always be at least one active Facility Admin.' } },
    });
    render(<People user={USERS.admin} />);
    const emma = await row('Emma Employee');
    await user.click(within(emma).getByRole('button', { name: 'Make admin' }));
    const alert = await within(emma).findByRole('alert');
    expect(alert).toHaveTextContent('There must always be at least one active Facility Admin.');
    expect(alert.compareDocumentPosition(within(emma).getByRole('group')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('searches and filters by role', async () => {
    const user = userEvent.setup();
    const api = backend();
    render(<People user={USERS.admin} />);
    await screen.findByText('Emma Employee');
    await user.selectOptions(screen.getByLabelText('Role'), 'engineer');
    await waitFor(() => expect(api.calls.at(-1).query.get('role')).toBe('engineer'));
    await user.type(screen.getByLabelText('Search name or email'), 'liam');
    await waitFor(() => expect(api.calls.at(-1).query.get('q')).toBe('liam'));
  });

  it('shows load errors and an empty result', async () => {
    mockApi({ 'GET /users': { status: 500, body: { message: 'Something went wrong. Please try again.' } } });
    const { unmount } = render(<People user={USERS.admin} />);
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    unmount();
    mockApi({ 'GET /users': { items: [], total: 0 } });
    render(<People user={USERS.admin} />);
    expect(await screen.findByText('Nobody matches.')).toBeInTheDocument();
  });

  it('shows cards on a phone', async () => {
    backend();
    render(<ResponsiveContext.Provider value={{ width: 390 }}><People user={USERS.admin} /></ResponsiveContext.Provider>);
    const list = await screen.findByRole('list', { name: 'People' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
