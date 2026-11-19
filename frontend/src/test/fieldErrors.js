import { screen } from '@testing-library/react';
import { expect } from 'vitest';

/** Assert `message` is shown ABOVE `input` (earlier in the page) and describes it. */
export function expectErrorAbove(input, message) {
  const text = screen.getByText(message, { exact: false, selector: 'span' });
  expect(text.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(input).toHaveAccessibleDescription(expect.stringContaining(message));
  expect(input).toHaveAttribute('aria-invalid', 'true');
}
