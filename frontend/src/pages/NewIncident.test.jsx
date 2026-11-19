import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { FACILITIES, USERS, incident, mockApi } from '../test/mockApi';
import NewIncident from './NewIncident';

const AC = {
  id: 4, reference: 'INC-000004', title: 'Air conditioning not cooling', category: 'hvac', status: 'in_progress',
  building: 'ACME Headquarters', floor: 'First Floor', seat: '1A-001', is_escalated: false,
  created_at: '2026-11-16T09:00:00Z', relation: null,
};

async function fillAndSubmit(user) {
  await user.type(await screen.findByLabelText(/^Title/), 'Too warm in finance');
  await user.type(screen.getByLabelText(/^Description/), 'It is 28 degrees.');
  await user.selectOptions(screen.getByLabelText(/^Category/), 'hvac');
  await waitFor(() => expect(screen.getByLabelText(/^Building/)).toBeEnabled());
  await user.selectOptions(screen.getByLabelText(/^Building/), '1');
  await user.selectOptions(screen.getByLabelText(/^Floor/), '10');
  await user.click(screen.getByRole('button', { name: 'Submit incident' }));
}

const created = (body) => ({ status: 201, body: incident({ id: 9, ...body }) });

describe('Reporting a problem that may already be reported', () => {
  beforeEach(() => {
    window.location.hash = '#/incidents/new';
  });

  it('reports straight away when nothing similar is open', async () => {
    const user = userEvent.setup();
    const api = mockApi({ 'GET /facilities': FACILITIES, 'GET /incidents/similar': [], 'POST /incidents': created });
    render(<NewIncident user={USERS.employee} />);
    await fillAndSubmit(user);

    await waitFor(() => expect(window.location.hash).toBe('#/incidents/9'));
    const check = api.calls.find((c) => c.path === '/incidents/similar');
    expect(Object.fromEntries(check.query)).toEqual({ building_id: '1', category: 'hvac', floor_id: '10' });
  });

  it('shows the open incident and requests escalation instead of a duplicate', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /facilities': FACILITIES,
      'GET /incidents/similar': [AC],
      'POST /incidents/4/escalation-request': () => incident({ id: 4 }),
    });
    render(<NewIncident user={USERS.employee} />);
    await fillAndSubmit(user);

    const dialog = await screen.findByRole('dialog', { name: 'This may already be reported' });
    const match = within(dialog).getByRole('listitem', { name: /INC-000004/ });
    expect(match).toHaveTextContent('Air conditioning not cooling');
    expect(match).toHaveTextContent('ACME Headquarters · First Floor · Seat 1A-001');
    expect(match).toHaveTextContent('In progress');

    await user.click(within(match).getByRole('button', { name: 'Request escalation' }));
    await user.type(within(match).getByLabelText(/Why is it urgent/), 'Whole team affected');
    await user.click(within(match).getByRole('button', { name: 'Send request' }));

    await waitFor(() => expect(window.location.hash).toBe('#/incidents/4'));
    expect(api.calls.at(-1)).toMatchObject({ method: 'POST', body: { reason: 'Whole team affected' } });
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/incidents')).toBe(false); // no duplicate
  });

  it('shows why a request was refused, above the reason box', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /facilities': FACILITIES,
      'GET /incidents/similar': [AC],
      'POST /incidents/4/escalation-request': {
        status: 409, body: { message: "You've already asked for this incident to be escalated." },
      },
    });
    render(<NewIncident user={USERS.employee} />);
    await fillAndSubmit(user);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Request escalation' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(await within(dialog).findByText("You've already asked for this incident to be escalated.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Why is it urgent/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('can still report it as a different problem', async () => {
    const user = userEvent.setup();
    const api = mockApi({ 'GET /facilities': FACILITIES, 'GET /incidents/similar': [AC], 'POST /incidents': created });
    render(<NewIncident user={USERS.employee} />);
    await fillAndSubmit(user);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /different problem, report it/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/incidents/9'));
    expect(api.calls.find((c) => c.method === 'POST').body).toMatchObject({ title: 'Too warm in finance', floor_id: 10 });
  });

  it('goes back to the form, which can be sent again', async () => {
    const user = userEvent.setup();
    mockApi({ 'GET /facilities': FACILITIES, 'GET /incidents/similar': [AC] });
    render(<NewIncident user={USERS.employee} />);
    await fillAndSubmit(user);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Back to form' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Submit incident' })).toBeEnabled();
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Too warm in finance');
  });

  it('links to an incident that is already yours instead of offering escalation', async () => {
    const user = userEvent.setup();
    mockApi({ 'GET /facilities': FACILITIES, 'GET /incidents/similar': [{ ...AC, relation: 'reporter', is_escalated: true }] });
    render(<NewIncident user={USERS.employee} />);
    await fillAndSubmit(user);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('You reported this.');
    expect(within(dialog).getByText('Escalated')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open it' })).toHaveAttribute('href', '#/incidents/4');
    expect(within(dialog).queryByRole('button', { name: 'Request escalation' })).not.toBeInTheDocument();
  });

  it('never blocks reporting when the check fails, and admins skip it', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /facilities': FACILITIES,
      'GET /incidents/similar': { status: 500, body: { message: 'Something went wrong.' } },
      'POST /incidents': created,
    });
    const { unmount } = render(<NewIncident user={USERS.employee} />);
    await fillAndSubmit(user);
    await waitFor(() => expect(window.location.hash).toBe('#/incidents/9'));
    unmount();

    window.location.hash = '#/incidents/new';
    api.calls.length = 0;
    render(<NewIncident user={USERS.admin} />);
    await fillAndSubmit(user);
    await waitFor(() => expect(window.location.hash).toBe('#/incidents/9'));
    expect(api.calls.some((c) => c.path === '/incidents/similar')).toBe(false);
  });

  it('reports a save failure inside the prompt', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /facilities': FACILITIES,
      'GET /incidents/similar': [AC],
      'POST /incidents': { status: 500, body: { message: 'Something went wrong. Please try again.' } },
    });
    render(<NewIncident user={USERS.employee} />);
    await fillAndSubmit(user);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /different problem, report it/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Something went wrong');
  });
});
