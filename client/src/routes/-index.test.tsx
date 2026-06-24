import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HomeComponent } from '../home/HomeComponent';
import { vi, describe, beforeEach, it, expect } from 'vitest';

const mockUseLogoutUser = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../user/hooks/useLogoutUser', () => ({
  useLogoutUser: () => mockUseLogoutUser(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockMutateAsync = vi.fn();

describe('HomeComponent', () => {
  beforeEach(() => {
    mockUseLogoutUser.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      error: null,
    });
    mockMutateAsync.mockResolvedValue(undefined);
    mockNavigate.mockClear();
  });

  it('renders welcome message and logout button', () => {
    render(<HomeComponent />);
    
    expect(screen.getByText('Welcome to Horizon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Logout/i })).toBeInTheDocument();
  });

  it('calls logout mutation and navigates on click', async () => {
    render(<HomeComponent />);

    fireEvent.click(screen.getByRole('button', { name: /Logout/i }));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' }));
  });
});
