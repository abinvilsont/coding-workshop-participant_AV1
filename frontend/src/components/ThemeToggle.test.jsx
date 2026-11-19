import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it } from 'vitest';
import { theme } from '../theme';
import { StatusBadge } from './Badges';
import ThemeToggle from './ThemeToggle';

const html = document.documentElement;

afterEach(() => {
  localStorage.clear();
  html.className = '';
});

describe('ThemeToggle', () => {
  it('switches between light and dark and remembers the choice', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider theme={theme}><ThemeToggle /></ThemeProvider>);

    // follows the device (light in jsdom) until the user picks
    await user.click(await screen.findByRole('button', { name: 'Switch to dark mode' }));
    expect(html).toHaveClass('dark');
    expect(localStorage.getItem('mui-mode')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(html).toHaveClass('light');
    expect(html).not.toHaveClass('dark');
    expect(localStorage.getItem('mui-mode')).toBe('light');
  });

  it('starts in the saved mode', async () => {
    localStorage.setItem('mui-mode', 'dark');
    render(<ThemeProvider theme={theme}><ThemeToggle /></ThemeProvider>);
    expect(await screen.findByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
    expect(html).toHaveClass('dark');
  });

  it('renders nothing outside the theme provider', () => {
    const { container } = render(<ThemeToggle />);
    expect(container).toBeEmptyDOMElement();
  });

  it('badges still render with scheme-aware colours', () => {
    render(<ThemeProvider theme={theme}><StatusBadge status="cancelled" /></ThemeProvider>);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });
});
