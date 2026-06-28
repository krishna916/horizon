import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test } from 'vitest';
import { PasswordInput } from './password-input';

test('toggles password visibility on icon click', () => {
  render(<PasswordInput placeholder="Enter password" />);
  const input = screen.getByPlaceholderText('Enter password') as HTMLInputElement;
  expect(input.type).toBe('password');

  const toggleButton = screen.getByRole('button');
  fireEvent.click(toggleButton);
  expect(input.type).toBe('text');

  fireEvent.click(toggleButton);
  expect(input.type).toBe('password');
});
