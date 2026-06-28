import type React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RegisterForm } from './RegisterForm';
import { useRegisterUser } from '../hooks/useRegisterUser';
import { vi, describe, beforeEach, it, expect } from 'vitest';

// Mock the registration hook
vi.mock('../hooks/useRegisterUser');

const mockMutateAsync = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => {
  return {
    useNavigate: () => mockNavigate,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

describe('RegisterForm', () => {
  beforeEach(() => {
    vi.mocked(useRegisterUser).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      error: null,
    } as unknown as ReturnType<typeof useRegisterUser>);
    mockMutateAsync.mockResolvedValue(undefined);
    mockNavigate.mockClear();
  });

  it('renders email, password, confirm password fields and terms checkbox', () => {
    render(<RegisterForm />);
    expect(screen.getByPlaceholderText('name@example.com')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('••••••••')).toHaveLength(2);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('shows validation errors for empty submission', async () => {
    render(<RegisterForm />);

    // We target the button text "Create Account"
    fireEvent.submit(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText('Email is required')).toBeInTheDocument();
      expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
      expect(screen.getByText('Please confirm your password')).toBeInTheDocument();
      expect(screen.getByText('You must agree to the terms and conditions')).toBeInTheDocument();
    });
  });

  it('shows validation error when passwords do not match', async () => {
    render(<RegisterForm />);

    fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
      target: { value: 'test@example.com' },
    });

    const passwordInputs = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(passwordInputs[0]!, {
      target: { value: 'strongPass123' },
    });
    fireEvent.change(passwordInputs[1]!, {
      target: { value: 'differentPass123' },
    });

    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.submit(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });
  });

  it('calls mutateAsync with valid data and navigates on success', async () => {
    render(<RegisterForm />);

    fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
      target: { value: 'test@example.com' },
    });

    const passwordInputs = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(passwordInputs[0]!, {
      target: { value: 'strongPass123' },
    });
    fireEvent.change(passwordInputs[1]!, {
      target: { value: 'strongPass123' },
    });

    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.submit(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'strongPass123',
      })
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/' }));
  });
});
