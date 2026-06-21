import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import App from './App';

test('renders App and checks heading', async () => {
  render(<App />);
  const heading = await screen.findByRole('heading', { name: /Welcome to Horizon/i, level: 1 });
  expect(heading).toBeInTheDocument();
});

