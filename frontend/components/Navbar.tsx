'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { authApi } from '@/lib/api';

export default function Navbar() {
  const { user, accessToken, logout } = useAuthStore();
  const router = useRouter();

  async function handleLogout() {
    try {
      await authApi.post('/auth/logout');
    } catch {
      // ignore
    }
    logout();
    router.push('/login');
  }

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <Link href="/associations" className="font-semibold text-gray-900 text-lg">
        VotingChain
      </Link>

      <div className="flex items-center gap-6">
        {accessToken ? (
          <>
            <Link href="/associations" className="text-sm text-gray-600 hover:text-gray-900">
              Associations
            </Link>
            <Link href="/profile" className="text-sm text-gray-600 hover:text-gray-900">
              {user?.email ?? 'Profile'}
            </Link>
            <button
              onClick={handleLogout}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Logout
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">
              Login
            </Link>
            <Link href="/register" className="text-sm text-gray-600 hover:text-gray-900">
              Register
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
