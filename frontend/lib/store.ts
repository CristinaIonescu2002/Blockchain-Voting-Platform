'use client';

import { create } from 'zustand';

export interface AuthUser {
  id: string;
  email: string;
  walletAddress: string | null;
}

interface AuthStore {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  // PEM stays in memory only — never sent to server, cleared on logout
  pemContent: string | null;
  walletAddress: string | null;

  setAuth: (access: string, refresh: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  setPem: (pem: string, address: string) => void;
  clearPem: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  pemContent: null,
  walletAddress: null,

  setAuth: (accessToken, refreshToken, user) =>
    set({ accessToken, refreshToken, user }),

  setUser: (user) => set({ user }),

  setPem: (pemContent, walletAddress) => set({ pemContent, walletAddress }),

  clearPem: () => set({ pemContent: null }),

  logout: () =>
    set({
      accessToken: null,
      refreshToken: null,
      user: null,
      pemContent: null,
      walletAddress: null,
    }),
}));
