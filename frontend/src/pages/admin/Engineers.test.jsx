import { render, screen, waitFor, within } from '@testing-library/react';
import { Context as ResponsiveContext } from 'react-responsive';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FACILITIES, mockApi } from '../../test/mockApi';
import Engineers from './Engineers';
import { expectErrorAbove } from '../../test/fieldErrors';

const ETHAN = {
  id: 2, name: 'Ethan Electrics', email: 'ethan.eng@acme.inc', phone: '+1-555-0110', department: 'Facilities',
  is_active: true, availability: 'available', specializations: ['electrical', 'hvac'], max_active_tickets: 5,
  home_building_id: 1, home_building: 'ACME Headquarters', notes: null, active_tickets: 5, remaining_capacity: 0,
};
const OMAR = { ...ETHAN, id: 5, name: 'Omar Hassan', email: 'omar.eng@acme.inc', is_active: false, availability: 'on_leave',
               specializations: [], home_building: null, active_tickets: 0 };

function backend(extra = {}) {
  let engineers = [ETHAN];
  return mockApi({
    'GET /facilities': FACILITIES,
    'GET /engineers': () => engineers,
    'POST /engineers': (body) => {
      const created = { ...ETHAN, ...body, id: 9, active_tickets: 0, home_building: null };
      engineers = [...engineers, created];
      return { status: 201, body: created };
    },
    'PATCH /engineers/2': (body) => {
      engineers = engineers.map((e) => (e.id === 2 ? { ...e, ...body } : e));
      return engineers[0];
    },
    ...extra,
  });
}

const field = (label) => screen.getByLabelText(new RegExp(`^${label}`));

describe('Engineers admin page', () => {
  it('lists engineers with workload', async () => {
    backend();
    render(<Engineers />);
    const row = (await screen.findByText('Ethan Electrics')).closest('tr');
    expect(row).toHaveTextContent('Electrical, HVAC');
    expect(row).toHaveTextContent('5 / 5');
    expect(within(row).getByRole('progressbar', { name: 'Workload 5 of 5' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('heading', { name: '1 engineer' })).toBeInTheDocument();
  });

  it('creates an engineer with a temporary password', async () => {
    const user = userEvent.setup();
    const api = backend();
    render(<Engineers />);
    await screen.findByText('Ethan Electrics');

    await user.click(screen.getByRole('button', { name: 'Add engineer' }));
    await user.type(field('Full name'), 'Grace Hopper');
    await user.type(field('Work email'), 'Grace.Eng@acme.inc');
    await user.type(field('Temporary password'), 'Welcome123!');
    await user.click(screen.getByLabelText('Network'));
    await user.click(screen.getByLabelText('IT hardware'));
    await user.selectOptions(field('Home building'), 'ACME Headquarters');
    await user.clear(field('Max active tickets'));
    await user.type(field('Max active tickets'), '3');
    await user.click(screen.getByRole('button', { name: 'Create engineer' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Grace Hopper can now sign in as grace.eng@acme.inc');
    expect(api.calls.find((c) => c.method === 'POST').body).toEqual({
      name: 'Grace Hopper', email: 'grace.eng@acme.inc', password: 'Welcome123!', phone: null, department: 'Facilities',
      specializations: ['network', 'it_hardware'], max_active_tickets: 3, availability: 'available', home_building_id: 1, notes: null,
    });
    expect(screen.getByRole('heading', { name: '2 engineers' })).toBeInTheDocument();
  });

  it('validates the new engineer form', async () => {
    const user = userEvent.setup();
    const api = backend();
    render(<Engineers />);
    await user.click(await screen.findByRole('button', { name: 'Add engineer' }));

    await user.click(screen.getByRole('button', { name: 'Create engineer' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expectErrorAbove(field('Full name'), 'Enter the engineer’s name.');
    expectErrorAbove(field('Work email'), 'Use an @acme.inc email address.');
    expectErrorAbove(field('Temporary password'), 'The temporary password needs at least 8 characters.');
    await waitFor(() => expect(field('Full name')).toHaveFocus());

    await user.type(field('Full name'), 'Grace');
    expect(field('Full name')).not.toHaveAttribute('aria-invalid', 'true');
    await user.type(field('Work email'), 'grace@gmail.com');
    await user.click(screen.getByRole('button', { name: 'Create engineer' }));
    expect(field('Work email')).toHaveAccessibleDescription('Use an @acme.inc email address.');
    await user.clear(field('Work email'));
    await user.type(field('Work email'), 'grace@acme.inc');
    await user.type(field('Temporary password'), 'short');
    await user.clear(field('Max active tickets'));
    await user.type(field('Max active tickets'), '0');
    await user.click(screen.getByRole('button', { name: 'Create engineer' }));
    expect(field('Temporary password')).toHaveAccessibleDescription('The temporary password needs at least 8 characters.');
    expect(field('Max active tickets')).toHaveAccessibleDescription('Enter a whole number from 1 to 50.');
    expect(field('Work email')).not.toHaveAttribute('aria-invalid', 'true');
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'New engineer' })).not.toBeInTheDocument();
  });

  it('edits an engineer and shows server refusals', async () => {
    const user = userEvent.setup();
    const api = backend({
      'PATCH /engineers/2': (body) => (body.is_active === false
        ? { status: 409, body: {
          message: 'Ethan Electrics still has 5 active ticket(s). Reassign them first.',
          errors: [{ loc: ['body', 'is_active'], msg: 'Ethan Electrics still has 5 active ticket(s). Reassign them first.' }],
        } }
        : { ...ETHAN, ...body }),
    });
    render(<Engineers />);
    const row = (await screen.findByText('Ethan Electrics')).closest('tr');
    await user.click(within(row).getByRole('button', { name: 'Edit' }));

    expect(field('Work email')).toBeDisabled();
    await user.selectOptions(field('Availability'), 'Busy');
    await user.click(screen.getByLabelText(/Account active/));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expectErrorAbove(screen.getByLabelText(/Account active/), 'Reassign them first.'));
    expect(api.calls.at(-1).body).toMatchObject({ availability: 'busy', is_active: false });

    await user.click(screen.getByLabelText(/Account active/));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved Ethan Electrics.');
  });

  it('can include inactive engineers', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /facilities': FACILITIES,
      'GET /engineers': () => (api.calls.at(-1).query.get('include_inactive') ? [ETHAN, OMAR] : [ETHAN]),
    });
    render(<Engineers />);
    await screen.findByText('Ethan Electrics');
    await user.click(screen.getByLabelText('Show inactive'));
    const row = (await screen.findByText('Omar Hassan')).closest('tr');
    expect(within(row).getByText('Inactive')).toBeInTheDocument();
  });

  it('has an empty state', async () => {
    mockApi({ 'GET /facilities': [], 'GET /engineers': [] });
    render(<Engineers />);
    expect(await screen.findByText('No engineers yet. Add the first one.')).toBeInTheDocument();
  });

  it('shows engineers as cards up to 1099 px, where all six columns fit', async () => {
    backend();
    const { unmount } = render(<ResponsiveContext.Provider value={{ width: 1024 }}><Engineers /></ResponsiveContext.Provider>);
    expect(await screen.findByRole('list', { name: 'Engineers' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    unmount();
    render(<ResponsiveContext.Provider value={{ width: 1100 }}><Engineers /></ResponsiveContext.Provider>);
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('shows engineers as cards on a phone', async () => {
    backend();
    render(<ResponsiveContext.Provider value={{ width: 390 }}><Engineers /></ResponsiveContext.Provider>);
    const list = await screen.findByRole('list', { name: 'Engineers' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const card = within(list).getByText('Ethan Electrics').closest('li');
    expect(card).toHaveTextContent('Electrical, HVAC');
    expect(within(card).getByRole('progressbar', { name: 'Workload 5 of 5' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('shows ratings and opens an engineer’s reviews', async () => {
    const user = userEvent.setup();
    const PRIYA = { ...ETHAN, id: 3, name: 'Priya Plumbing', email: 'priya.eng@acme.inc', avg_rating: 4.5, review_count: 2 };
    const api = mockApi({
      'GET /facilities': FACILITIES,
      'GET /engineers': [ETHAN, PRIYA],
      'GET /engineers/3/reviews': [
        { id: 1, engineer_id: 3, engineer_name: 'Priya Plumbing', reviewer_id: 6, reviewer_name: 'Emma Employee', rating: 5,
          comment: 'Quick fix and kept me updated.', created_at: '2026-11-17T09:00:00Z', updated_at: '2026-11-17T09:00:00Z',
          incident_id: 1, incident_reference: 'INC-000001', incident_title: 'Broken chair' },
      ],
    });
    render(<Engineers />);

    const ethan = (await screen.findByText('Ethan Electrics')).closest('tr');
    expect(ethan).toHaveTextContent('No reviews');
    await user.click(screen.getByRole('button', { name: /^Priya Plumbing: 4.5 out of 5 from 2 reviews/ }));

    const panel = await screen.findByRole('region', { name: 'Reviews of Priya Plumbing' });
    expect(await within(panel).findByText('Quick fix and kept me updated.')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'INC-000001' })).toHaveAttribute('href', '#/incidents/1');
    expect(within(panel).getByRole('img', { name: '5 stars' })).toBeInTheDocument();
    expect(api.calls.at(-1).path).toBe('/engineers/3/reviews');

    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Reviews of Priya Plumbing' })).not.toBeInTheDocument();
  });

  it('shows when loading reviews fails', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /facilities': FACILITIES,
      'GET /engineers': [{ ...ETHAN, avg_rating: 3, review_count: 1 }],
      'GET /engineers/2/reviews': { status: 500, body: { message: 'Something went wrong.' } },
    });
    render(<Engineers />);
    await user.click(await screen.findByRole('button', { name: /from 1 review\./ }));
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
  });
});
