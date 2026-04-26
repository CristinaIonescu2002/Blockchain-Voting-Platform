'use client';

import axios from 'axios';
import { useAuthStore } from './store';

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? 'http://localhost:3001';
const ASSOC_URL = process.env.NEXT_PUBLIC_ASSOC_URL ?? 'http://localhost:3002';
const VOTE_URL = process.env.NEXT_PUBLIC_VOTE_URL ?? 'http://localhost:3003';
const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL ?? 'http://localhost:3004';

function makeClient(baseURL: string) {
  const client = axios.create({ baseURL });

  client.interceptors.request.use((config) => {
    const token = useAuthStore.getState().accessToken;
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  client.interceptors.response.use(
    (res) => res,
    async (err) => {
      const original = err.config;
      if (err.response?.status === 401 && !original._retry) {
        original._retry = true;
        const { refreshToken, setAuth, logout } = useAuthStore.getState();
        if (refreshToken) {
          try {
            const { data } = await axios.post(`${AUTH_URL}/auth/refresh`, {
              refreshToken,
            });
            setAuth(data.accessToken, data.refreshToken, data.user);
            original.headers.Authorization = `Bearer ${data.accessToken}`;
            return client(original);
          } catch {
            logout();
          }
        } else {
          logout();
        }
      }
      return Promise.reject(err);
    },
  );

  return client;
}

export const authApi = makeClient(AUTH_URL);
export const assocApi = makeClient(ASSOC_URL);
export const voteApi = makeClient(VOTE_URL);
export const bridgeApi = makeClient(BRIDGE_URL);
