import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context as ResponsiveContext } from 'react-responsive';
import { describe, expect, it, vi } from 'vitest';
import { USERS, mockApi } from '../test/mockApi';
import Login from './Login';
import { expectErrorAbove } from '../test/fieldErrors';

const input = (label) => screen.getByLabelText(new RegExp(`^${label}`), { selector: 'input' });

const fill = async (user, fields) => {
  for (const [label, value] of Object.entries(fields)) {
    await user.clear(input(label));
    await user.type(input(label), value);
  }
};

describe('Login page', () => {
  it('signs in and hands the user to the app', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    mockApi({ 'POST /auth/login': { token: 'tok', user: USERS.admin } });
    render(<Login onLogin={onLogin} />);

    await fill(user, { 'Work email': 'alice.admin@acme.inc', Password: 'Password123!' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(USERS.admin));
  });

  it('validates before calling the server', async () => {
    const user = userEvent.setup();
    const api = mockApi({});
    render(<Login />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    // no banner at the top: each message sits above its own field, and the cursor goes to the first
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expectErrorAbove(input('Work email'), 'Enter your work email.');
    expectErrorAbove(input('Password'), 'Enter your password.');
    await waitFor(() => expect(input('Work email')).toHaveFocus());
    expect(input('Work email')).toBeRequired();

    await fill(user, { 'Work email': 'me@gmail.com', Password: 'Password123!' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(input('Work email')).toHaveAccessibleDescription('Please use your @acme.inc email address.');
    expect(input('Password')).not.toHaveAttribute('aria-invalid', 'true');
    expect(api.calls).toHaveLength(0);
  });

  it('shows the server error for bad credentials', async () => {
    const user = userEvent.setup();
    mockApi({ 'POST /auth/login': { status: 401, body: { message: 'Invalid email or password.' } } });
    render(<Login />);

    await fill(user, { 'Work email': 'emma@acme.inc', Password: 'wrong-password' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('shows a wrong password above the password field when the server names it', async () => {
    const user = userEvent.setup();
    const message = 'Invalid email or password.';
    mockApi({ 'POST /auth/login': { status: 401, body: { message, errors: [{ loc: ['body', 'password'], msg: message }] } } });
    render(<Login />);
    await fill(user, { 'Work email': 'emma@acme.inc', Password: 'wrong-password' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expectErrorAbove(input('Password'), message));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the button while signing in', async () => {
    const user = userEvent.setup();
    let release;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { release = resolve; })));
    render(<Login />);

    await fill(user, { 'Work email': 'emma@acme.inc', Password: 'Password123!' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
    release(new Response(JSON.stringify({ message: 'nope' }), { status: 401 }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('puts server validation errors on the matching field', async () => {
    const user = userEvent.setup();
    mockApi({ 'POST /auth/register': { status: 400, body: {
      message: 'Password must be at most 72 characters.',
      errors: [{ loc: ['body', 'password'], msg: 'Value error, Password must be at most 72 characters.' }],
    } } });
    render(<Login />);
    await user.click(screen.getByRole('tab', { name: 'Register' }));
    await fill(user, {
      'Full name': 'Jane Doe', 'Work email': 'jane@acme.inc', Password: 'Password123!', 'Confirm password': 'Password123!',
    });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expectErrorAbove(input('Password'), 'Password must be at most 72 characters.'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(input('Password')).toHaveFocus());
  });

  it('registers an employee, then returns to sign in', async () => {
    const user = userEvent.setup();
    const api = mockApi({ 'POST /auth/register': { status: 201, body: { user: USERS.employee } } });
    render(<Login />);

    await user.click(screen.getByRole('tab', { name: 'Register' }));
    await fill(user, {
      'Full name': 'Jane Doe', 'Work email': 'jane@acme.inc', Password: 'Password123!', 'Confirm password': 'Password123!',
    });
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Account created. You can now sign in.');
    expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
    expect(api.calls[0].body).toMatchObject({ name: 'Jane Doe', email: 'jane@acme.inc' });
  });

  it('checks registration fields', async () => {
    const user = userEvent.setup();
    mockApi({});
    render(<Login />);
    await user.click(screen.getByRole('tab', { name: 'Register' }));

    await fill(user, { 'Work email': 'jane@acme.inc', Password: 'short', 'Confirm password': 'short' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expectErrorAbove(input('Full name'), 'Please enter your full name.');
    expectErrorAbove(input('Password'), 'Password must be at least 8 characters.');

    await fill(user, { 'Full name': 'Jane' });
    expect(input('Full name')).not.toHaveAttribute('aria-invalid', 'true'); // fixed as you type

    await fill(user, { Password: '-long-enough', 'Confirm password': '-different!' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(input('Confirm password')).toHaveAccessibleDescription('Passwords do not match.');
    expect(input('Password')).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('can reveal the password', async () => {
    const user = userEvent.setup();
    render(<Login />);
    const input = screen.getByLabelText(/^Password/, { selector: 'input' });
    expect(input).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
  });

  it('drops the side panel on a phone but keeps the brand', () => {
    const { unmount } = render(<Login />);
    expect(screen.getByText(/Resolve assigned tickets/)).toBeInTheDocument();
    unmount();

    render(
      <ResponsiveContext.Provider value={{ width: 390 }}>
        <Login />
      </ResponsiveContext.Provider>,
    );
    expect(screen.getByRole('heading', { name: 'ACME Facility Desk' })).toBeInTheDocument();
    expect(screen.queryByText(/Resolve assigned tickets/)).not.toBeInTheDocument();
  });
});
