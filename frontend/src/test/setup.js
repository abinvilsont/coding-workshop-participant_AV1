import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has no scrolling; the router calls scrollTo on navigation
window.scrollTo = () => {};

// jsdom has no matchMedia; React Responsive and MUI need it. Desktop by default
// (tests that need a phone wrap the tree in react-responsive's Context).
window.matchMedia = window.matchMedia || ((query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  window.location.hash = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
