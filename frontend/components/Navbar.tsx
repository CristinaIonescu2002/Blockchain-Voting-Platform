'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/store';
import { authApi } from '@/lib/api';

export default function Navbar() {
  const { user, accessToken, logout } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();

  async function handleLogout() {
    try {
      await authApi.post('/auth/logout');
    } catch {
      // ignore
    }
    logout();
    qc.clear(); // wipe all cached queries so the next user starts fresh
    router.push('/login');
  }

  return (
    <nav className="bg-green-700 px-6 py-3 flex items-center justify-between shadow-md">
      <Link href="/associations" className="font-bold text-white text-xl tracking-wide">
        🗳 VotingChain
      </Link>

      <div className="flex items-center gap-6">
        {accessToken ? (
          <>
            <Link href="/associations" className="text-sm text-green-100 hover:text-white transition-colors">
              Associations
            </Link>
            <Link href="/profile" className="text-sm text-green-100 hover:text-white transition-colors">
              {user?.email ?? 'Profile'}
            </Link>
            <button
              onClick={handleLogout}
              className="text-sm bg-white text-green-700 font-medium px-3 py-1 rounded hover:bg-green-50 transition-colors"
            >
              Logout
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="text-sm text-green-100 hover:text-white transition-colors">
              Login
            </Link>
            <Link href="/register" className="text-sm bg-white text-green-700 font-medium px-3 py-1 rounded hover:bg-green-50 transition-colors">
              Register
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
