import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { getCurrentSessionEpoch, notifySessionUnauthorized } from '@/user/session/sessionRuntime';

// Shared Axios instance for Horizon frontend API calls.
// In development, Vite proxies /api to the backend (localhost:8081).
// In production, the same origin is used.
export const apiClient = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

const requestEpochs = new WeakMap<InternalAxiosRequestConfig, number>();

apiClient.interceptors.request.use((config) => {
  requestEpochs.set(config, getCurrentSessionEpoch());
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && error.config) {
      const path = (error.config.url ?? '').split('?')[0] ?? '';
      const isPublicAuthRequest = /\/auth\/(login|register|logout)$/.test(path);
      const isCurrentUserCheck = /\/users\/me$/.test(path);
      if (!isPublicAuthRequest && !isCurrentUserCheck) {
        notifySessionUnauthorized(requestEpochs.get(error.config) ?? getCurrentSessionEpoch());
      }
    }
    return Promise.reject(error);
  }
);
