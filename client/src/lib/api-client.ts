import axios from 'axios';

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
