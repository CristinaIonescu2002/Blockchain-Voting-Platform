'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  const { accessToken, walletAddress, pemContent } = useAuthStore();
  const [newName, setNewName] = useState('');
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!accessToken) router.replace('/login');
  }, [accessToken, router]);

  const { data: associations = [], isLoading } = useQuery<Association[]>({
    queryKey: ['associations', 'mine'],
    queryFn: async () => {
      const { data } = await assocApi.get('/associations/my');
      return data;
    },
    enabled: !!accessToken,
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!pemContent || !walletAddress) {
      setFormError('Load your PEM wallet first (go to Profile).');
      return;
    }
    setCreating(true);
    try {
      // 1. Create association in DB (draft)
      const { data: assoc } = await assocApi.post('/associations', { name: newName });

      // 2. Get unsigned tx from bridge
      const { data: unsignedTx } = await bridgeApi.get(
        `/bridge/tx/register-association?name=${encodeURIComponent(newName)}&senderAddress=${walletAddress}`,
      );

      // 3. Sign with PEM
      const signedTx = await signTx(pemContent, unsignedTx);

      // 4. Submit to bridge → broadcasts to chain
      const { data: submitResult } = await bridgeApi.post('/bridge/tx/submit', { tx: signedTx });

      // 5. Patch association with scAssocId if bridge returned it
      if (submitResult?.scAssocId != null) {
        await assocApi.patch(`/associations/${assoc.id}`, { scAssocId: submitResult.scAssocId });
      }

      setNewName('');
      qc.invalidateQueries({ queryKey: ['associations', 'mine'] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setFormError(typeof msg === 'string' ? msg : 'Failed to create association');
    } finally {
      setCreating(false);
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
          <p className="text-xs text-amber-600 mb-3">
            You need to load your PEM wallet to register on-chain.{' '}
            <Link href="/profile" className="underline">
              Go to Profile
            </Link>
          </p>
        )}
        <form onSubmit={handleCreate} className="flex gap-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Association name"
            required
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={creating}
            className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
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
              <Link
                href={`/associations/${a.id}`}
                className="block bg-white rounded border border-gray-200 px-5 py-4 hover:border-blue-400 transition-colors"
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-xs text-gray-400">
                    {a.scAssocId != null ? `On-chain #${a.scAssocId}` : 'Not on-chain yet'}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
