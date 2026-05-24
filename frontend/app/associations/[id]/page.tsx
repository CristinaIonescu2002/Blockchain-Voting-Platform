'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assocApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { parsePem } from '@/lib/wallet';

interface Association {
  id: string;
  name: string;
  scAssocId: number | null;
  adminUserId: string;
  paymasterWallet: string | null;
}

interface Member {
  id: string;
  userId: string;
  walletAddress: string | null;
  status: string;
  user?: { email: string };
}

export default function AssociationDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { accessToken, user, walletAddress } = useAuthStore();

  const [addEmail, setAddEmail] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const [paymasterUploading, setPaymasterUploading] = useState(false);
  const [paymasterError, setPaymasterError] = useState('');
  const [acceptingInvite, setAcceptingInvite] = useState(false);
  const [acceptError, setAcceptError] = useState('');

  useEffect(() => {
    if (!accessToken) router.replace('/login');
  }, [accessToken, router]);

  const { data: assoc, isLoading: assocLoading } = useQuery<Association>({
    queryKey: ['association', id],
    queryFn: async () => {
      const { data } = await assocApi.get(`/associations/${id}`);
      return data;
    },
    enabled: !!accessToken && !!id,
  });

  const { data: members = [], isLoading: membersLoading } = useQuery<Member[]>({
    queryKey: ['association', id, 'members'],
    queryFn: async () => {
      const { data } = await assocApi.get(`/associations/${id}/members`);
      return data;
    },
    enabled: !!accessToken && !!id,
  });

  const isAdmin = assoc?.adminUserId === user?.id;
  const myMembership = members.find((member) => member.userId === user?.id);
  const invitePending = myMembership?.status === 'pending';

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    setAdding(true);
    try {
      // Pass email — association-service resolves wallet from auth.users
      await assocApi.post(`/associations/${id}/members`, { userEmail: addEmail });
      setAddEmail('');
      qc.invalidateQueries({ queryKey: ['association', id, 'members'] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setAddError(typeof msg === 'string' ? msg : 'Failed to add member');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    try {
      await assocApi.delete(`/associations/${id}/members/${memberId}`);
      qc.invalidateQueries({ queryKey: ['association', id, 'members'] });
    } catch {
      // ignore
    }
  }

  async function handleAcceptInvite() {
    setAcceptError('');
    if (!walletAddress) {
      setAcceptError('Link a wallet on your Profile page before accepting.');
      return;
    }

    setAcceptingInvite(true);
    try {
      await assocApi.post(`/associations/${id}/members/accept`);
      qc.invalidateQueries({ queryKey: ['association', id, 'members'] });
      qc.invalidateQueries({ queryKey: ['associations', 'mine'] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setAcceptError(typeof msg === 'string' ? msg : 'Failed to accept invite');
    } finally {
      setAcceptingInvite(false);
    }
  }

  async function handlePaymasterPem(file: File | null) {
    if (!file) return;
    setPaymasterError('');
    setPaymasterUploading(true);
    try {
      const pemContent = await file.text();
      const { address } = parsePem(pemContent);
      await assocApi.post(`/associations/${id}/paymaster`, {
        walletAddress: address,
        pemContent,
      });
      qc.invalidateQueries({ queryKey: ['association', id] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setPaymasterError(typeof msg === 'string' ? msg : 'Invalid paymaster PEM');
    } finally {
      setPaymasterUploading(false);
    }
  }

  if (assocLoading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!assoc) return <p className="text-sm text-red-600">Association not found.</p>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Link href="/associations" className="text-sm text-green-600 hover:underline">
          ← Associations
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-1">{assoc.name}</h1>
      <p className="text-xs text-gray-400 mb-6">
        {assoc.scAssocId != null ? `On-chain ID: ${assoc.scAssocId}` : 'Not registered on-chain yet'}
      </p>

      <div className="flex gap-3 mb-8">
        <Link
          href={`/associations/${id}/sessions`}
          className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700"
        >
          Voting sessions
        </Link>
      </div>

      {invitePending && (
        <div className="bg-amber-50 rounded border border-amber-200 p-4 mb-6">
          <p className="text-sm text-amber-800 mb-3">
            You have a pending invitation to this association.
          </p>
          <button
            type="button"
            onClick={handleAcceptInvite}
            disabled={acceptingInvite}
            className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {acceptingInvite ? 'Accepting...' : 'Accept invitation'}
          </button>
          {acceptError && <p className="text-sm text-red-600 mt-2">{acceptError}</p>}
        </div>
      )}

      {isAdmin && (
        <div className="bg-white rounded border border-gray-200 p-5 mb-6">
          <h2 className="font-medium mb-3">Association paymaster</h2>
          <p className="text-sm text-gray-600 mb-3">
            This wallet pays gas automatically for member vote submissions.
          </p>
          {assoc.paymasterWallet ? (
            <p className="text-xs text-gray-500 font-mono break-all mb-3">
              {assoc.paymasterWallet}
            </p>
          ) : (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 mb-3">
              No paymaster configured. Members can sign votes, but automatic submission will fail.
            </p>
          )}
          <label className="inline-block bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700 cursor-pointer">
            {paymasterUploading ? 'Uploading...' : 'Upload paymaster PEM'}
            <input
              type="file"
              accept=".pem"
              className="hidden"
              disabled={paymasterUploading}
              onChange={(e) => void handlePaymasterPem(e.target.files?.[0] ?? null)}
            />
          </label>
          {paymasterError && <p className="text-sm text-red-600 mt-2">{paymasterError}</p>}
        </div>
      )}

      {/* Members */}
      <div className="bg-white rounded border border-gray-200 p-5">
        <h2 className="font-medium mb-4">Members</h2>

        {isAdmin && (
          <form onSubmit={handleAddMember} className="flex gap-3 mb-4">
            <input
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="Member email"
              required
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <button
              type="submit"
              disabled={adding}
              className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
          </form>
        )}
        {addError && <p className="text-sm text-red-600 mb-3">{addError}</p>}

        {membersLoading ? (
          <p className="text-sm text-gray-500">Loading members…</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-gray-500">No members yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {members.map((m) => (
              <li key={m.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm">{m.user?.email ?? m.userId}</p>
                  {m.status === 'pending' && (
                    <span className="mt-1 inline-block rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Pending
                    </span>
                  )}
                  <p className="text-xs text-gray-400 font-mono">{m.walletAddress ?? '—'}</p>
                </div>
                {isAdmin && m.userId !== user?.id && (
                  <button
                    onClick={() => handleRemoveMember(m.userId)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
