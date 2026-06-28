import { apiClient } from '@/lib/api-client';
import type { RegisterUserRequest, LoginRequest, CurrentUserResponse } from './types';

export const userApi = {
  register: (data: RegisterUserRequest) =>
    apiClient.post<CurrentUserResponse>('/auth/register', data),
  login: (data: LoginRequest) => apiClient.post<CurrentUserResponse>('/auth/login', data),
  getCurrentUser: () => apiClient.get<CurrentUserResponse>('/users/me'),
  logout: () => apiClient.post<void>('/auth/logout'),
};
