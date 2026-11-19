import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FACILITIES, mockApi } from '../test/mockApi';
import { ApiError } from '../services/apiClient';
import IncidentForm from './IncidentForm';
import { expectErrorAbove } from '../test/fieldErrors';

const field = (name) => screen.getByLabelText(new RegExp(`^${name}`));

async function renderForm(props = {}) {
  mockApi({ 'GET /facilities': FACILITIES });
  const onSubmit = props.onSubmit ?? vi.fn();
  render(<IncidentForm submitLabel="Submit incident" onSubmit={onSubmit} {...props} />);
  await waitFor(() => expect(field('Building')).toBeEnabled());
  return onSubmit;
}

describe('IncidentForm', () => {
  it('requires title, description, category and building', async () => {
    const user = userEvent.setup();
    const onSubmit = await renderForm();
    await user.type(field('Title'), '   ');
    await user.click(screen.getByRole('button', { name: 'Submit incident' }));
    // no banner at the top: each problem is shown above its own field, and the cursor goes to the first
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expectErrorAbove(field('Title'), 'Enter a short title.');
    expectErrorAbove(field('Description'), 'Describe the problem.');
    expectErrorAbove(field('Category'), 'Choose a category.');
    expectErrorAbove(field('Building'), 'Choose a building.');
    await waitFor(() => expect(field('Title')).toHaveFocus());
    expect(onSubmit).not.toHaveBeenCalled();

    // typing fixes clear that field's message only
    await user.type(field('Title'), 'Projector broken');
    expect(field('Title')).not.toHaveAttribute('aria-invalid', 'true');
    expect(field('Description')).toHaveAttribute('aria-invalid', 'true');
  });

  it('cascades building -> floor -> seat and submits numeric ids', async () => {
    const user = userEvent.setup();
    const onSubmit = await renderForm();

    expect(field('Floor')).toBeDisabled();
    await user.type(field('Title'), '  Leaking tap ');
    await user.type(field('Description'), 'Dripping all day');
    await user.selectOptions(field('Category'), 'plumbing');
    await user.selectOptions(field('Building'), 'ACME Headquarters');
    expect(field('Seat')).toBeDisabled();
    await user.selectOptions(field('Floor'), 'First Floor');
    await user.selectOptions(field('Seat'), '1A-001 – Window');
    await user.selectOptions(field('Priority'), 'High');
    await user.click(screen.getByRole('button', { name: 'Submit incident' }));

    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Leaking tap', description: 'Dripping all day', category: 'plumbing', priority: 'high',
      building_id: 1, floor_id: 10, seat_id: 100, location_details: null,
    });
  });

  it('clears floor and seat when the building changes', async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.selectOptions(field('Building'), 'ACME Headquarters');
    expect(screen.getByRole('option', { name: 'Floor 2' })).toBeInTheDocument(); // unnamed floor
    await user.selectOptions(field('Floor'), 'First Floor');
    await user.selectOptions(field('Seat'), '1A-001 – Window');
    await user.selectOptions(field('Building'), 'Innovation Hub');
    expect(field('Floor')).toHaveValue('');
    expect(field('Seat')).toHaveValue('');
    expect(field('Seat')).toBeDisabled();
  });

  it('only offers critical priority to admins', async () => {
    await renderForm();
    expect(screen.queryByRole('option', { name: 'Critical' })).not.toBeInTheDocument();
  });

  it('offers critical priority when allowed', async () => {
    await renderForm({ allowCritical: true });
    expect(screen.getByRole('option', { name: 'Critical' })).toBeInTheDocument();
  });

  it('pre-fills for editing and can hide priority', async () => {
    await renderForm({ initial: { title: 'Old title', description: 'D', category: 'hvac', building_id: 1, floor_id: null }, showPriority: false });
    expect(field('Title')).toHaveValue('Old title');
    expect(field('Category')).toHaveValue('hvac');
    expect(screen.queryByLabelText(/^Priority/)).not.toBeInTheDocument();
  });

  it('shows server validation errors above the matching field', async () => {
    const user = userEvent.setup();
    const err = new ApiError(400, 'Title must be at most 200 characters.', { title: 'Title must be at most 200 characters.' });
    const onSubmit = vi.fn().mockRejectedValue(err);
    await renderForm({ onSubmit, initial: { title: 'T', description: 'D', category: 'hvac', building_id: 1 } });
    await user.click(screen.getByRole('button', { name: 'Submit incident' }));
    await waitFor(() => expectErrorAbove(field('Title'), 'Title must be at most 200 characters.'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a location error from the server above the floor', async () => {
    const user = userEvent.setup();
    const message = 'That floor is not in the selected building.';
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(400, message, { floor_id: message }));
    await renderForm({ onSubmit, initial: { title: 'T', description: 'D', category: 'hvac', building_id: 1 } });
    await user.click(screen.getByRole('button', { name: 'Submit incident' }));
    await waitFor(() => expectErrorAbove(field('Floor'), message));
  });

  it('shows errors that name no field above the buttons, and lets the user retry', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Cannot reach the server. Is the backend running?'));
    await renderForm({ onSubmit, initial: { title: 'T', description: 'D', category: 'hvac', building_id: 1 } });
    await user.click(screen.getByRole('button', { name: 'Submit incident' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Cannot reach the server.');
    const submit = screen.getByRole('button', { name: 'Submit incident' });
    expect(alert.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(submit).toBeEnabled();
  });

  it('reports when facilities cannot load', async () => {
    mockApi({ 'GET /facilities': { status: 500, body: { message: 'Something went wrong. Please try again.' } } });
    render(<IncidentForm onSubmit={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });
});
