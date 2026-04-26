'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { authApi } from '@/lib/api';
import { parsePem } from '@/lib/wallet';

export default function ProfilePage() {
  const router = useRouter();
  const { user, accessToken, walletAddress, setUser, setPem, clearPem } = useAuthStore();
  const [pemFile, setPemFile] = useState<File | null>(null);
  const [pemError, setPemError] = useState('');
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    if (!accessToken) router.replace('/login');
  }, [accessToken, router]);

  if (!user) return null;

  async function handleLinkWallet(e: React.FormEvent) {
    e.preventDefault();
    if (!pemFile) return;
    setPemError('');
    setLinking(true);

    try {
      const pemContent = await pemFile.text();
      const { address } = parsePem(pemContent);
      await authApi.post('/auth/link-wallet', { walletAddress: address });
      setPem(pemContent, address);
      setUser({ ...user!, walletAddress: address });
      setLinked(true);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setPemError(typeof msg === 'string' ? msg : 'Failed to link wallet');
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold mb-6">Profile</h1>

      <div className="bg-white rounded border border-gray-200 p-5 space-y-3 mb-8">
        <div>
          <span className="text-xs text-gray-500 uppercase tracking-wide">Email</span>
          <p className="text-sm">{user.email}</p>
        </div>
        <div>
          <span className="text-xs text-gray-500 uppercase tracking-wide">Wallet address</span>
          <p className="text-sm font-mono break-all">
            {user.walletAddress ?? <span className="text-gray-400">Not linked</span>}
          </p>
        </div>
        {walletAddress && (
          <div>
            <span className="text-xs text-gray-500 uppercase tracking-wide">PEM loaded</span>
            <p className="text-sm text-green-600">
              Active in browser memory{' '}
              <button
                onClick={clearPem}
                className="text-red-500 hover:underline text-xs ml-2"
              >
                Clear
              </button>
            </p>
          </div>
        )}
      </div>

      <div className="bg-white rounded border border-gray-200 p-5">
        <h2 className="font-medium mb-3">Link wallet</h2>
        <p className="text-xs text-gray-500 mb-4">
          Upload your PEM file. The key stays in browser memory only — it is never sent to the
          server.
        </p>

        {linked ? (
          <p className="text-sm text-green-600">Wallet linked successfully.</p>
        ) : (
          <form onSubmit={handleLinkWallet} className="space-y-3">
            <input
              type="file"
              accept=".pem"
              onChange={(e) => setPemFile(e.target.files?.[0] ?? null)}
              className="text-sm text-gray-600"
            />
            {pemError && <p className="text-sm text-red-600">{pemError}</p>}
            <button
              type="submit"
              disabled={!pemFile || linking}
              className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {linking ? 'Linking…' : 'Link wallet'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
