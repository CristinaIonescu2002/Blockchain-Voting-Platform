'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assocApi, bridgeApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { signTx } from '@/lib/wallet';

interface Association {
  id: string;
  name: string;
  scAssocId: number | null;
  adminUserId: string;
}

export default function AssociationsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { accessToken, walletAddress, pemContent, user } = useAuthStore();
  const [newName, setNewName] = useState('');
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!accessToken) router.replace('/login');
  }, [accessToken, router]);

  const { data: associations = [], isLoading } = useQuery<Association[]>({
    queryKey: ['associations', 'mine', user?.id],
    queryFn: async () => {
      const { data } = await assocApi.get('/associations/my');
      return data;
    },
    enabled: !!accessToken && !!user?.id,
  });

  /** Build + sign + submit the on-chain registration for any association (new or existing). */
  async function registerOnChain(assocId: string, assocName: string) {
    if (!pemContent || !walletAddress) return;
    try {
      // 1. Get unsigned tx
      const { data: unsignedTx } = await bridgeApi.get(
        `/bridge/tx/register-association?name=${encodeURIComponent(assocName)}&senderAddress=${walletAddress}`,
      );
      // 2. Sign
      const signedTx = await signTx(pemContent, unsignedTx);
      // 3. Submit — bridge confirms async and patches scAssocId in DB
      await bridgeApi.post('/bridge/tx/submit', { signedTx, associationId: assocId });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      throw new Error(typeof msg === 'string' ? msg : 'On-chain registration failed');
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!pemContent || !walletAddress) {
      setFormError('Load your PEM wallet first (go to Profile).');
      return;
    }
    setCreating(true);
    try {
      // 1. Create association in DB
      const { data: assoc } = await assocApi.post('/associations', { name: newName });
      // 2. Register on-chain
      await registerOnChain(assoc.id, newName);

      setNewName('');
      qc.invalidateQueries({ queryKey: ['associations', 'mine'] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message;
      setFormError(typeof msg === 'string' ? msg : 'Failed to create association');
    } finally {
      setCreating(false);
    }
  }

  async function handleRegisterOnChain(assoc: Association) {
    setRegisterError((prev) => ({ ...prev, [assoc.id]: '' }));
    setRegisteringId(assoc.id);
    try {
      await registerOnChain(assoc.id, assoc.name);
      // Refresh after a short delay to let bridge async-patch scAssocId
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['associations', 'mine'] });
      }, 9_000);
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? 'On-chain registration failed';
      setRegisterError((prev) => ({ ...prev, [assoc.id]: msg }));
    } finally {
      setRegisteringId(null);
    }
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">My Associations</h1>

      {/* Create form */}
      <div className="bg-white rounded border border-gray-200 p-5 mb-8">
        <h2 className="font-medium mb-3">Create new association</h2>
        {!pemContent && (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-3 text-xs text-amber-700">
            You need to load your PEM wallet to register on-chain.{' '}
            <Link href="/profile" className="underline font-medium">
              Go to Profile →
            </Link>
          </div>
        )}
        <form onSubmit={handleCreate} className="flex gap-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Association name"
            required
            disabled={!pemContent}
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            type="submit"
            disabled={creating || !pemContent}
            className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>
        {formError && <p className="text-sm text-red-600 mt-2">{formError}</p>}
      </div>

      {/* List */}
      {associations.length === 0 ? (
        <p className="text-sm text-gray-500">No associations yet.</p>
      ) : (
        <ul className="space-y-3">
          {associations.map((a) => (
            <li key={a.id}>
              <div className="bg-white rounded border border-gray-200 px-5 py-4">
                <div className="flex items-center justify-between">
                  <Link
                    href={`/associations/${a.id}`}
                    className="font-medium hover:text-green-700 transition-colors"
                  >
                    {a.name}
                  </Link>

                  {a.scAssocId != null ? (
                    <span className="text-xs text-green-600 font-medium">
                      On-chain #{a.scAssocId}
                    </span>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-amber-600">Not on-chain yet</span>
                      {pemContent && a.adminUserId === user?.id && (
                        <button
                          onClick={() => handleRegisterOnChain(a)}
                          disabled={registeringId === a.id}
                          className="text-xs bg-amber-100 text-amber-800 border border-amber-300 rounded px-2.5 py-1 hover:bg-amber-200 disabled:opacity-50 transition-colors"
                        >
                          {registeringId === a.id ? 'Registering…' : 'Register on-chain'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {a.scAssocId == null && pemContent && registeringId === a.id && (
                  <p className="text-xs text-amber-600 mt-2">
                    Transaction submitted. On-chain ID will appear here in ~10 seconds…
                  </p>
                )}
                {registerError[a.id] && (
                  <p className="text-xs text-red-600 mt-1">{registerError[a.id]}</p>
                )}

                {a.scAssocId == null && !pemContent && a.adminUserId === user?.id && (
                  <p className="text-xs text-gray-400 mt-1">
                    Load your PEM on the{' '}
                    <Link href="/profile" className="underline">
                      Profile page
                    </Link>{' '}
                    to register on-chain.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
