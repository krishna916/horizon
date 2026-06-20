import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import App from './App';

test('renders App and checks heading', () => {
  render(<App />);
  const heading = screen.getByRole('heading', { name: /Get started/i, level: 1 });
  expect(heading).toBeInTheDocument();
});
