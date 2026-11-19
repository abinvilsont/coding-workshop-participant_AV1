import { render, screen, waitFor, within } from '@testing-library/react';
import { Context as ResponsiveContext } from 'react-responsive';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FACILITIES, mockApi } from '../../test/mockApi';
import Facilities from './Facilities';
import { expectErrorAbove } from '../../test/fieldErrors';

// A tiny in-memory facilities backend so every change is reloaded like the real one
let tree;
let api;
const findFloor = (id) => tree.flatMap((b) => b.floors).find((f) => f.id === id);
const findSeat = (id) => tree.flatMap((b) => b.floors).flatMap((f) => f.seats).find((s) => s.id === id);

function backend(extra = {}) {
  tree = structuredClone(FACILITIES);
  let nextId = 500;
  const routes = {
    'GET /facilities': () => tree,
    'POST /buildings': (body) => {
      const b = { id: nextId++, ...body, code: body.code.toUpperCase(), is_active: true, floors: [] };
      tree.push(b);
      return { status: 201, body: b };
    },
    'POST /floors': (body) => {
      const f = { id: nextId++, ...body, is_active: true, seats: [] };
      tree.find((b) => b.id === body.building_id).floors.push(f);
      return { status: 201, body: f };
    },
    'POST /seats': (body) => {
      const s = { id: nextId++, ...body, is_active: true };
      findFloor(body.floor_id).seats.push(s);
      return { status: 201, body: s };
    },
    'PATCH /buildings/1': (body) => Object.assign(tree[0], body),
    'PATCH /floors/10': (body) => Object.assign(findFloor(10), body),
    'PATCH /seats/100': (body) => Object.assign(findSeat(100), body),
    'DELETE /buildings/1': { status: 409, body: { message: 'This building is referenced by incidents or engineer profiles. Deactivate it instead.' } },
    'DELETE /seats/100': () => {
      findFloor(10).seats = [];
      return { status: 204, body: null };
    },
    ...extra,
  };
  api = mockApi(routes);
}

async function renderPage() {
  render(<Facilities />);
  return screen.findByRole('heading', { name: 'Buildings (2)' });
}

describe('Facilities admin page', () => {
  beforeEach(() => backend());

  it('lists buildings with floor and seat counts and shows the first one', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: /HQ1 ACME Headquarters/ })).toHaveTextContent('2 floors · 1 seat');
    expect(screen.getByText('Floor 1')).toBeInTheDocument();
    expect(screen.getByText('1A-001')).toBeInTheDocument();
    expect(api.calls[0].query.get('include_inactive')).toBe('true');
  });

  it('creates a building and selects it', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Add building' }));
    const create = screen.getByRole('button', { name: 'Create building' });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText(/^Code/), 'lon');
    await user.type(screen.getByLabelText(/^Name/), 'London Office');
    await user.type(screen.getByLabelText(/^City/), 'London');
    await user.click(create);

    expect(await screen.findByRole('heading', { name: 'Buildings (3)' })).toBeInTheDocument();
    expect(api.calls.find((c) => c.method === 'POST').body).toEqual({ code: 'lon', name: 'London Office', address: null, city: 'London', country: null });
    expect(screen.getByText('No floors yet.')).toBeInTheDocument();
  });

  it('flags an empty required field when you leave it, and shows server field errors under the field', async () => {
    const user = userEvent.setup();
    backend({ 'POST /buildings': { status: 400, body: {
      message: 'code: String should have at most 20 characters',
      errors: [{ loc: ['body', 'code'], msg: 'String should have at most 20 characters' }],
    } } });
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Add building' }));

    const code = screen.getByLabelText(/^Code/);
    await user.click(code);
    await user.tab();
    expect(code).toHaveAccessibleDescription('Enter a short code, e.g. HQ2.');
    expect(code).toHaveAttribute('aria-invalid', 'true');

    await user.type(code, 'LON');
    expect(code).not.toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByLabelText(/^Name/), 'London Office');
    await user.click(screen.getByRole('button', { name: 'Create building' }));
    expect(await screen.findByText('String should have at most 20 characters')).toBeInTheDocument();
    expect(code).toHaveAccessibleDescription('String should have at most 20 characters');

    await user.type(code, 'X'); // editing the field hides the stale server message
    expect(code).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('adds a floor and a seat', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.type(screen.getByLabelText('New floor number'), '3');
    await user.type(screen.getByLabelText('New floor name'), 'Sales');
    await user.click(screen.getByRole('button', { name: 'Add floor' }));
    expect(await screen.findByText('Floor 3')).toBeInTheDocument();
    expect(screen.getByLabelText('New floor number')).toHaveValue(null);

    const floor3 = screen.getByRole('region', { name: 'Floor 3' });
    await user.type(within(floor3).getByLabelText('New seat code'), '3-001');
    await user.click(within(floor3).getByRole('button', { name: 'Add seat' }));
    expect(await within(floor3).findByText('3-001')).toBeInTheDocument();
  });

  it('shows a clash right above the field that caused it, not at the top of the page', async () => {
    const user = userEvent.setup();
    const message = 'That seat code already exists on this floor.';
    backend({ 'POST /seats': { status: 409, body: { message, errors: [{ loc: ['body', 'seat_code'], msg: message }] } } });
    await renderPage();
    const floor1 = screen.getByRole('region', { name: 'Floor 1' });
    await user.type(within(floor1).getByLabelText('New seat code'), '1A-001');
    await user.click(within(floor1).getByRole('button', { name: 'Add seat' }));
    await waitFor(() => expectErrorAbove(within(floor1).getByLabelText('New seat code'), message));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('edits a building, a floor and a seat', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const name = screen.getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, 'HQ Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('button', { name: /HQ1 HQ Renamed/ })).toBeInTheDocument();

    const floor1 = screen.getByRole('region', { name: 'Floor 1' });
    await user.click(within(floor1).getAllByRole('button', { name: 'Edit' })[0]);
    await user.clear(screen.getByLabelText('Floor name'));
    await user.type(screen.getByLabelText('Floor name'), 'Finance');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Finance')).toBeInTheDocument();

    const seatRow = screen.getByText('1A-001').closest('tr');
    await user.click(within(seatRow).getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), 'Corner desk');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Corner desk')).toBeInTheDocument();
  });

  it('deactivates and reactivates', async () => {
    const user = userEvent.setup();
    await renderPage();
    const seatRow = screen.getByText('1A-001').closest('tr');
    await user.click(within(seatRow).getByRole('button', { name: 'Deactivate' }));
    expect(await within(seatRow).findByText('Inactive')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Floor 1' })).toHaveTextContent('0 active seats');

    await user.click(screen.getAllByRole('button', { name: 'Deactivate' }).at(0));
    expect(await screen.findByText(/Inactive buildings are hidden from the report form/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Reactivate' })[0]); // building header comes first
    expect(await screen.findByRole('button', { name: /HQ1 ACME Headquarters/ })).not.toHaveTextContent('inactive');
  });

  it('deletes a seat after confirming', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderPage();
    const seatRow = screen.getByText('1A-001').closest('tr');
    await user.click(within(seatRow).getByRole('button', { name: 'Delete' }));
    expect(window.confirm).toHaveBeenCalledWith('Delete seat 1A-001?');
    await vi.waitFor(() => expect(screen.queryByText('1A-001')).not.toBeInTheDocument());
  });

  it('explains why a building in use cannot be deleted', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderPage();
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Deactivate it instead.');
  });

  it('switches between buildings', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: /INN Innovation Hub/ }));
    expect(screen.getByText('No floors yet.')).toBeInTheDocument();
  });

  it('shows a load error', async () => {
    mockApi({ 'GET /facilities': { status: 500, body: { message: 'Something went wrong. Please try again.' } } });
    render(<Facilities />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('lists seats without a table on a phone and still edits them', async () => {
    const user = userEvent.setup();
    render(<ResponsiveContext.Provider value={{ width: 390 }}><Facilities /></ResponsiveContext.Provider>);
    await screen.findByRole('heading', { name: 'Buildings (2)' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const seats = within(screen.getByRole('region', { name: 'Floor 1' })).getByRole('list', { name: 'Seats' });
    expect(seats).toHaveTextContent('1A-001');
    await user.click(within(seats).getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), 'Window seat');
    await user.click(within(seats).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Window seat')).toBeInTheDocument();
  });
});
