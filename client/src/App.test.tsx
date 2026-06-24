import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import App from './App';

vi.mock('@/user/api', () => ({
  userApi: {
    getCurrentUser: vi.fn().mockResolvedValue({
      data: { id: 1, email: 'test@example.com' },
    }),
    logout: vi.fn().mockResolvedValue({}),
  },
}));

test('renders App and checks heading', async () => {
  render(<App />);
  const heading = await screen.findByRole('heading', { name: /Welcome to Horizon/i, level: 1 });
  expect(heading).toBeInTheDocument();
});

