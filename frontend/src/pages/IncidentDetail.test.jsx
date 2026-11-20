import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { USERS, incident, mockApi } from '../test/mockApi';
import IncidentDetail from './IncidentDetail';
import { expectErrorAbove } from '../test/fieldErrors';

const NOTES = [
  { id: 1, body: 'Refrigerant is low.', is_internal: false, created_at: '2026-11-16T10:00:00Z', author_id: 2, author_name: 'Ethan Electrics', author_role: 'engineer' },
];
const HISTORY = [
  { id: 1, event_type: 'created', from_value: null, to_value: 'open', comment: null, changed_by: 'Emma Employee', created_at: '2026-11-15T09:00:00Z' },
  { id: 2, event_type: 'assignment', from_value: null, to_value: 'Ethan Electrics', comment: null, changed_by: 'Alice Admin', created_at: '2026-11-15T10:00:00Z' },
  { id: 3, event_type: 'status_change', from_value: 'assigned', to_value: 'in_progress', comment: null, changed_by: 'Ethan Electrics', created_at: '2026-11-15T11:00:00Z' },
  { id: 4, event_type: 'assignment', from_value: 'Ethan Electrics', to_value: 'Tom Tech', comment: null, changed_by: 'Alice Admin', created_at: '2026-11-15T12:00:00Z' },
  { id: 5, event_type: 'assignment', from_value: 'Tom Tech', to_value: null, comment: null, changed_by: null, created_at: '2026-11-15T13:00:00Z' },
];

function setup(inc, extraRoutes = {}) {
  const api = mockApi({
    [`GET /incidents/${inc.id}`]: inc,
    'POST /notifications/read-all': { unread_count: 0 },
    'GET /engineers': [
      { id: 2, name: 'Ethan Electrics', availability: 'available', active_tickets: 1, max_active_tickets: 5, remaining_capacity: 4, specializations: ['hvac'] },
      { id: 4, name: 'Tom Tech', availability: 'busy', active_tickets: 2, max_active_tickets: 6, remaining_capacity: 4, specializations: [] },
      { id: 3, name: 'Priya Plumbing', availability: 'available', active_tickets: 4, max_active_tickets: 4, remaining_capacity: 0, specializations: [] },
    ],
    ...extraRoutes,
  });
  return api;
}

describe('IncidentDetail', () => {
  it('shows the incident, notes and readable history, and marks notifications read', async () => {
    const api = setup(incident({ notes: NOTES, history: HISTORY }));
    render(<IncidentDetail id={4} user={USERS.employee} />);

    expect(await screen.findByRole('heading', { name: 'Air conditioning not cooling' })).toBeInTheDocument();
    expect(screen.getByText('Refrigerant is low.')).toBeInTheDocument();
    expect(screen.getByText('Assigned to Ethan Electrics')).toBeInTheDocument();
    expect(screen.getByText('Changed status: Assigned → In progress')).toBeInTheDocument();
    expect(screen.getByText('Reassigned: Ethan Electrics → Tom Tech')).toBeInTheDocument();
    expect(screen.getByText('Took Tom Tech off the incident')).toBeInTheDocument(); // moved back to Open
    const readAll = api.calls.find((c) => c.path === '/notifications/read-all');
    expect(readAll.query.get('incident_id')).toBe('4');
  });

  it('employee on a ticket in progress sees no admin actions', async () => {
    setup(incident({ permissions: { can_add_note: true } }));
    render(<IncidentDetail id={4} user={USERS.employee} />);
    await screen.findByRole('heading', { name: 'Air conditioning not cooling' });

    expect(screen.queryByRole('heading', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Internal/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled();
  });

  it('admin sees assign, priority and delete', async () => {
    setup(incident({
      permissions: { can_edit: true, can_assign: true, can_set_priority: true, can_delete: true,
                     can_add_note: true, can_add_internal_note: true, status_transitions: ['on_hold', 'resolved'] },
    }));
    render(<IncidentDetail id={4} user={USERS.admin} />);
    await screen.findByRole('heading', { name: 'Actions' });

    expect(screen.getByRole('heading', { name: 'Reassign engineer' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /Tom Tech · Busy · 2\/6/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set priority' })).toBeDisabled(); // unchanged
    expect(screen.getByRole('button', { name: 'Delete incident' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Put on hold' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Internal/)).toBeInTheDocument();
  });

  it('changes status with an optional comment and shows the result', async () => {
    const user = userEvent.setup();
    const api = setup(incident({ permissions: { status_transitions: ['on_hold', 'resolved'] } }), {
      'POST /incidents/4/status': (body) => incident({ status: body.status }),
    });
    render(<IncidentDetail id={4} user={USERS.engineer} />);

    await user.type(await screen.findByPlaceholderText(/Optional comment/), 'Fixed the compressor');
    await user.click(screen.getByRole('button', { name: 'Mark resolved' }));

    expect(api.calls.at(-1).body).toEqual({ status: 'resolved', comment: 'Fixed the compressor' });
    expect(await within(screen.getByTestId('incident-badges')).findByText('Resolved')).toBeInTheDocument();
  });

  it('asks before cancelling', async () => {
    const user = userEvent.setup();
    const api = setup(incident({ status: 'open', permissions: { status_transitions: ['cancelled'] } }));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<IncidentDetail id={4} user={USERS.employee} />);

    await user.click(await screen.findByRole('button', { name: 'Cancel incident' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(api.calls.some((c) => c.path === '/incidents/4/status')).toBe(false);
  });

  it('adds an internal note as an engineer', async () => {
    const user = userEvent.setup();
    const api = setup(incident({ permissions: { can_add_note: true, can_add_internal_note: true } }), {
      'POST /incidents/4/notes': (body) => incident({ notes: [{ ...NOTES[0], id: 2, body: body.body, is_internal: true }],
                                                     permissions: { can_add_note: true, can_add_internal_note: true } }),
    });
    render(<IncidentDetail id={4} user={USERS.engineer} />);

    await user.type(await screen.findByPlaceholderText('Write a note…'), 'Supplier PO #4471');
    await user.click(screen.getByLabelText(/Internal/));
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(api.calls.at(-1).body).toEqual({ body: 'Supplier PO #4471', is_internal: true });
    const note = (await screen.findByText('Supplier PO #4471')).closest('li');
    expect(within(note).getByText('Internal')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Write a note…')).toHaveValue('');
  });

  it('lets the reporter escalate and request a higher priority', async () => {
    const user = userEvent.setup();
    const api = setup(incident({ permissions: { can_escalate: true } }), {
      'POST /incidents/4/escalate': incident({ is_escalated: true, escalation_reason: 'Board meeting', requested_priority: 'critical' }),
    });
    render(<IncidentDetail id={4} user={USERS.employee} />);

    await user.click(await screen.findByRole('button', { name: /Escalate \/ request/ }));
    expect(screen.queryByRole('option', { name: 'Request Low' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escalate' })).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Why is this urgent?'), 'Board meeting');
    await user.selectOptions(screen.getByRole('combobox'), 'Request Critical');
    await user.click(screen.getByRole('button', { name: 'Escalate' }));

    expect(api.calls.at(-1).body).toEqual({ reason: 'Board meeting', requested_priority: 'critical' });
    expect(await screen.findByText('Escalation reason')).toBeInTheDocument();
    expect(screen.getByText('→ Critical requested')).toBeInTheDocument();
  });

  it('admin assigns an engineer and approves a priority request', async () => {
    const user = userEvent.setup();
    const perms = { can_assign: true, can_set_priority: true };
    const api = setup(incident({ assigned_engineer_id: null, assigned_engineer: null, status: 'open', is_escalated: true,
                                 requested_priority: 'high', permissions: perms }), {
      'POST /incidents/4/assign': incident({ status: 'assigned', assigned_engineer: 'Tom Tech', assigned_engineer_id: 4,
                                             is_escalated: true, requested_priority: 'high', permissions: perms }),
      'PATCH /incidents/4': (body) => incident({ ...body, status: 'assigned', permissions: perms }),
    });
    render(<IncidentDetail id={4} user={USERS.admin} />);

    expect(await screen.findByText(/Employee requested/)).toHaveTextContent('Employee requested High.');
    const assignBlock = screen.getByRole('heading', { name: 'Assign engineer' }).closest('section');
    await within(assignBlock).findByRole('option', { name: /Tom Tech/ });
    await user.selectOptions(within(assignBlock).getByRole('combobox'), '4');
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(api.calls.find((c) => c.path === '/incidents/4/assign').body).toEqual({ engineer_id: 4 });
    expect(await screen.findAllByText('Tom Tech')).not.toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Set priority' }));
    expect(api.calls.at(-1).body).toEqual({ priority: 'high' });
  });

  it('marks engineers at full capacity and stops them being picked', async () => {
    const perms = { can_assign: true };
    setup(incident({ assigned_engineer_id: null, assigned_engineer: null, status: 'open', permissions: perms }));
    render(<IncidentDetail id={4} user={USERS.admin} />);

    const assignBlock = (await screen.findByRole('heading', { name: 'Assign engineer' })).closest('section');
    const full = await within(assignBlock).findByRole('option', { name: /Priya Plumbing/ });
    expect(full).toHaveTextContent('4/4 (full)');
    expect(full).toBeDisabled();
    expect(within(assignBlock).getByRole('option', { name: /Tom Tech/ })).toBeEnabled();
  });

  it('keeps the current engineer selectable even when they are full', async () => {
    const perms = { can_assign: true };
    setup(incident({ assigned_engineer_id: 3, assigned_engineer: 'Priya Plumbing', status: 'assigned', permissions: perms }));
    render(<IncidentDetail id={4} user={USERS.admin} />);

    const assignBlock = (await screen.findByRole('heading', { name: 'Reassign engineer' })).closest('section');
    expect(await within(assignBlock).findByRole('option', { name: /Priya Plumbing/ })).toBeEnabled();
  });

  it('shows the capacity error if the engineer filled up meanwhile', async () => {
    const user = userEvent.setup();
    const perms = { can_assign: true };
    const message = 'Tom Tech is at full capacity (6/6 active tickets). Choose another engineer, or raise their limit on the Engineers page.';
    setup(incident({ assigned_engineer_id: null, assigned_engineer: null, status: 'open', permissions: perms }), {
      'POST /incidents/4/assign': { status: 409, body: { message } },
    });
    render(<IncidentDetail id={4} user={USERS.admin} />);

    const assignBlock = (await screen.findByRole('heading', { name: 'Assign engineer' })).closest('section');
    await within(assignBlock).findByRole('option', { name: /Tom Tech/ });
    await user.selectOptions(within(assignBlock).getByRole('combobox'), '4');
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    // shown inside the Assign box, right above the engineer picker - not at the top of the page
    await waitFor(() => expectErrorAbove(within(assignBlock).getByRole('combobox'), message));
  });

  it('edits details in place', async () => {
    const user = userEvent.setup();
    const api = setup(incident({ status: 'open', permissions: { can_edit: true } }), {
      'GET /facilities': [],
      'PATCH /incidents/4': (body) => incident({ ...body, status: 'open', permissions: { can_edit: true } }),
    });
    render(<IncidentDetail id={4} user={USERS.employee} />);

    await user.click(await screen.findByRole('button', { name: 'Edit details' }));
    const title = screen.getByLabelText(/^Title/);
    await user.clear(title);
    await user.type(title, 'AC broken');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('heading', { name: 'AC broken' })).toBeInTheDocument();
    expect(api.calls.at(-1).body).not.toHaveProperty('priority');
    // tells the API which version the edit started from
    expect(api.calls.at(-1).body.expected_updated_at).toBe('2026-11-17T09:00:00Z');
  });

  it('does not overwrite a change someone else saved while you were editing', async () => {
    const user = userEvent.setup();
    let current = incident({ status: 'open', permissions: { can_edit: true } });
    const api = setup(current, {
      'GET /incidents/4': () => current,
      'GET /facilities': [],
      'PATCH /incidents/4': () => {
        // Tom renamed it a moment earlier
        current = incident({ title: 'AC fixed by Tom', status: 'open', updated_at: '2026-11-17T10:00:00Z',
          permissions: { can_edit: true } });
        return { status: 409, body: { message: 'Someone updated this incident while you were editing.' } };
      },
    });
    render(<IncidentDetail id={4} user={USERS.employee} />);

    await user.click(await screen.findByRole('button', { name: 'Edit details' }));
    await user.clear(screen.getByLabelText(/^Title/));
    await user.type(screen.getByLabelText(/^Title/), 'My stale title');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    // the form closes on the latest version, with a warning where it was
    expect(await screen.findByRole('heading', { name: 'AC fixed by Tom' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("Your changes weren't saved: someone updated this incident");
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();

    // editing again starts from the new version
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toHaveValue('AC fixed by Tom');
    expect(api.calls.filter((c) => c.method === 'GET' && c.path === '/incidents/4')).toHaveLength(2);
  });

  it('reloads the incident when an action is refused because it changed meanwhile', async () => {
    const user = userEvent.setup();
    let current = incident({ status: 'assigned', permissions: { status_transitions: ['cancelled'] } });
    const api = setup(current, {
      'GET /incidents/4': () => current,
      'POST /incidents/4/status': () => {
        current = incident({ status: 'in_progress', permissions: { status_transitions: [] } }); // Tom started work
        return { status: 403, body: { message: "You can't change this incident from in_progress to cancelled." } };
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<IncidentDetail id={4} user={USERS.employee} />);

    await user.click(await screen.findByRole('button', { name: 'Cancel incident' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('from in_progress to cancelled');
    await waitFor(() => expect(screen.getByTestId('incident-badges')).toHaveTextContent('In progress'));
    expect(screen.queryByRole('button', { name: 'Cancel incident' })).not.toBeInTheDocument();
    expect(api.calls.filter((c) => c.method === 'GET' && c.path === '/incidents/4')).toHaveLength(2);
  });

  it('says the ticket is no longer theirs when it was reassigned while the page was open', async () => {
    const user = userEvent.setup();
    let reassigned = false;
    setup(incident({ status: 'in_progress', permissions: { status_transitions: ['on_hold', 'resolved'] } }), {
      'GET /incidents/4': () => (reassigned
        ? { status: 404, body: { message: 'Incident not found.' } }
        : incident({ status: 'in_progress', permissions: { status_transitions: ['on_hold', 'resolved'] } })),
      'POST /incidents/4/status': () => {
        reassigned = true; // an admin gave it to another engineer a moment ago
        return { status: 404, body: { message: 'Incident not found.' } };
      },
    });
    render(<IncidentDetail id={4} user={USERS.engineer} />);

    await user.click(await screen.findByRole('button', { name: 'Put on hold' }));
    expect(await screen.findByText(/may have been reassigned to someone else/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Put on hold' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Incidents/ })).toBeInTheDocument();
  });

  it('deletes after confirmation and returns to the list', async () => {
    const user = userEvent.setup();
    setup(incident({ permissions: { can_delete: true } }), { 'DELETE /incidents/4': { status: 204, body: null } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<IncidentDetail id={4} user={USERS.admin} />);

    await user.click(await screen.findByRole('button', { name: 'Delete incident' }));
    await vi.waitFor(() => expect(window.location.hash).toBe('#/incidents'));
  });

  it('shows action errors from the server', async () => {
    const user = userEvent.setup();
    setup(incident({ permissions: { status_transitions: ['resolved'] } }), {
      'POST /incidents/4/status': { status: 403, body: { message: "You can't change this incident from closed to resolved." } },
    });
    render(<IncidentDetail id={4} user={USERS.engineer} />);
    await user.click(await screen.findByRole('button', { name: 'Mark resolved' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("You can't change this incident");
  });

  it('shows a not-found message', async () => {
    mockApi({ 'GET /incidents/99': { status: 404, body: { message: 'Incident not found.' } } });
    render(<IncidentDetail id={99} user={USERS.employee} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Incident not found.');
  });

  it('says when notes are closed', async () => {
    setup(incident({ status: 'closed' }));
    render(<IncidentDetail id={4} user={USERS.employee} />);
    expect(await screen.findByText('Notes are closed for this incident.')).toBeInTheDocument();
    expect(screen.getByText('No notes yet.')).toBeInTheDocument();
  });

  describe('duplicates', () => {
    const CANDIDATES = [
      incident({ id: 9, reference: 'INC-000009', title: 'AC blowing warm air', status: 'assigned' }),
      incident({ id: 12, reference: 'INC-000012', title: 'Lights flicker', status: 'open' }),
    ];

    it('admin merges this incident into another and is taken there', async () => {
      const user = userEvent.setup();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const api = setup(incident({ status: 'open', permissions: { can_merge: true } }), {
        'GET /incidents/4/merge-candidates': CANDIDATES,
        'POST /incidents/4/merge': incident({ id: 9, reference: 'INC-000009' }),
      });
      render(<IncidentDetail id={4} user={USERS.admin} />);

      const block = await screen.findByRole('region', { name: 'Merge duplicate' });
      const select = within(block).getByLabelText(/^Merge into/);
      await within(block).findByRole('option', { name: /INC-000009 · AC blowing warm air · ACME Headquarters · Assigned/ });
      expect(within(block).getByRole('button', { name: 'Merge' })).toBeDisabled();

      await user.selectOptions(select, '9');
      await user.click(within(block).getByRole('button', { name: 'Merge' }));
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Merge INC-000004 into INC-000009?'));
      expect(api.calls.find((c) => c.path === '/incidents/4/merge').body).toEqual({ target_id: 9 });
      await vi.waitFor(() => expect(window.location.hash).toBe('#/incidents/9'));
    });

    it('does nothing when the admin cancels the confirmation', async () => {
      const user = userEvent.setup();
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const api = setup(incident({ status: 'open', permissions: { can_merge: true } }), {
        'GET /incidents/4/merge-candidates': CANDIDATES,
      });
      render(<IncidentDetail id={4} user={USERS.admin} />);
      const block = await screen.findByRole('region', { name: 'Merge duplicate' });
      await within(block).findByRole('option', { name: /INC-000012/ });
      await user.selectOptions(within(block).getByLabelText(/^Merge into/), '12');
      await user.click(within(block).getByRole('button', { name: 'Merge' }));
      expect(api.calls.some((c) => c.path === '/incidents/4/merge')).toBe(false);
    });

    it('says so when there is nothing to merge into', async () => {
      setup(incident({ status: 'open', permissions: { can_merge: true } }), {
        'GET /incidents/4/merge-candidates': [],
      });
      render(<IncidentDetail id={4} user={USERS.admin} />);
      expect(await screen.findByText('No other open incidents to merge into.')).toBeInTheDocument();
    });

    it('shows a merged duplicate with a link to the main incident', async () => {
      setup(incident({ status: 'cancelled', merged_into: { id: 9, reference: 'INC-000009', title: 'AC blowing warm air' } }));
      render(<IncidentDetail id={4} user={USERS.employee} />);
      expect(await screen.findByRole('link', { name: 'INC-000009 · AC blowing warm air' })).toHaveAttribute('href', '#/incidents/9');
      expect(within(screen.getByTestId('incident-badges')).getByText('Merged')).toBeInTheDocument();
      expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
    });

    it('lists who else reported it and tells a follower why they see it', async () => {
      const liam = { id: 7, name: 'Liam Lee', email: 'liam.lee@acme.inc', role: 'employee' };
      setup(incident({
        merged_from: [{ id: 15, reference: 'INC-000015', title: 'AC warm', reported_by: 'Liam Lee' }],
        followers: [{ id: 7, name: 'Liam Lee' }],
      }));
      render(<IncidentDetail id={4} user={liam} />);
      const details = await screen.findByTestId('incident-details');
      expect(details).toHaveTextContent('Also reported byLiam Lee (INC-000015)');
      expect(within(details).getByRole('link', { name: 'INC-000015' })).toHaveAttribute('href', '#/incidents/15');
      expect(screen.getByText(/You're following this incident/)).toHaveTextContent('Emma Employee confirms the fix.');
    });

    it('shows who asked for escalation, and tells them why they follow it', async () => {
      const liam = { id: 7, name: 'Liam Lee', email: 'liam.lee@acme.inc', role: 'employee' };
      setup(incident({
        is_escalated: true,
        followers: [{ id: 7, name: 'Liam Lee', escalation_requested_at: '2026-11-19T09:00:00Z' }],
      }));
      render(<IncidentDetail id={4} user={liam} />);
      const details = await screen.findByTestId('incident-details');
      expect(details).toHaveTextContent('Asked to escalateLiam Lee');
      expect(screen.getByText(/You're following this incident/)).toHaveTextContent(
        'because you have the same problem and asked for it to be escalated',
      );
    });

    it('does not show the follower notice to the original reporter', async () => {
      setup(incident({ followers: [{ id: 7, name: 'Liam Lee' }] }));
      render(<IncidentDetail id={4} user={USERS.employee} />);
      await screen.findByRole('heading', { name: 'Air conditioning not cooling' });
      expect(screen.queryByText(/You're following this incident/)).not.toBeInTheDocument();
    });
  });

  describe('engineer reviews', () => {
    const closed = (overrides = {}) =>
      incident({ status: 'closed', assigned_engineer: 'Tom Tech', assigned_engineer_id: 4, ...overrides });
    const REVIEW = {
      id: 1, engineer_id: 4, engineer_name: 'Tom Tech', reviewer_id: 6, reviewer_name: 'Emma Employee',
      rating: 4, comment: 'Quick fix.', created_at: '2026-11-18T09:00:00Z', updated_at: '2026-11-18T09:00:00Z',
    };

    it('employee rates the engineer of a closed incident', async () => {
      const user = userEvent.setup();
      const api = setup(closed({ permissions: { can_review: true } }), {
        'POST /incidents/4/review': () => ({ status: 201, body: closed({ reviews: [REVIEW] }) }),
      });
      render(<IncidentDetail id={4} user={USERS.employee} />);

      const section = await screen.findByRole('region', { name: 'Rate Tom Tech' });
      expect(section).toHaveTextContent("Only you and Facility Admins see your review. Tom Tech won't.");
      const submit = within(section).getByRole('button', { name: 'Submit review' });
      expect(submit).toBeDisabled();
      // MUI Rating reads hover from element sizes, which jsdom lacks, so click the radio itself
      fireEvent.click(within(section).getByRole('radio', { name: '4 stars' }));
      expect(section).toHaveTextContent('Very good');
      await user.type(within(section).getByLabelText('Comment (optional)'), '  Quick fix.  ');
      await user.click(submit);

      expect(api.calls.at(-1)).toMatchObject({ method: 'POST', path: '/incidents/4/review', body: { rating: 4, comment: 'Quick fix.' } });
      expect(await within(section).findByText('Your review')).toBeInTheDocument();
      expect(within(section).getByRole('img', { name: '4 stars' })).toBeInTheDocument();
    });

    it('employee edits and deletes their review', async () => {
      const user = userEvent.setup();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      let current = closed({ reviews: [REVIEW] });
      const api = setup(current, {
        'GET /incidents/4': () => current,
        'PUT /incidents/4/review': (body) => (current = closed({ reviews: [{ ...REVIEW, ...body }] })),
        'DELETE /incidents/4/review': () => {
          current = closed({ permissions: { can_review: true } });
          return { status: 204, body: null };
        },
      });
      render(<IncidentDetail id={4} user={USERS.employee} />);

      const section = await screen.findByRole('region', { name: 'Rate Tom Tech' });
      expect(section).toHaveTextContent('Quick fix.');
      await user.click(within(section).getByRole('button', { name: 'Edit review' }));
      fireEvent.click(within(section).getByRole('radio', { name: '2 stars' }));
      await user.clear(within(section).getByLabelText('Comment (optional)'));
      await user.click(within(section).getByRole('button', { name: 'Save review' }));
      expect(api.calls.at(-1)).toMatchObject({ method: 'PUT', body: { rating: 2, comment: null } });
      expect(await within(section).findByRole('img', { name: '2 stars' })).toBeInTheDocument();

      await user.click(within(section).getByRole('button', { name: 'Delete' }));
      expect(await within(section).findByRole('button', { name: 'Submit review' })).toBeInTheDocument();
      expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true);
    });

    it('admin reads every review', async () => {
      setup(closed({ reviews: [REVIEW, { ...REVIEW, id: 2, reviewer_id: 7, reviewer_name: 'Liam Lee', rating: 2, comment: null }] }));
      render(<IncidentDetail id={4} user={USERS.admin} />);
      const section = await screen.findByRole('region', { name: 'Engineer reviews (2)' });
      expect(section).toHaveTextContent('Emma Employee rated Tom Tech');
      expect(section).toHaveTextContent('Liam Lee rated Tom Tech');
      expect(within(section).queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows nothing to engineers, or before the incident is closed', async () => {
      setup(closed());
      render(<IncidentDetail id={4} user={USERS.engineer} />);
      await screen.findByRole('heading', { name: 'Air conditioning not cooling' });
      expect(screen.queryByText(/review/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: /Rate/ })).not.toBeInTheDocument();
    });
  });
});
