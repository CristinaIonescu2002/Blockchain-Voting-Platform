'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assocApi, voteApi, bridgeApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { signTx } from '@/lib/wallet';

interface Session {
  id: string;
  title: string;
  status: string;
  deadline: string;
  scSessionId: number | null;
}

interface Member {
  id: string;
  userId: string;
  walletAddress: string | null;
  user?: { email: string };
}

export default function SessionsPage() {
  const router = useRouter();
  const { id: assocId } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { accessToken, user, pemContent, walletAddress } = useAuthStore();

  // Form state
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [quorum, setQuorum] = useState(1);
  const [candidates, setCandidates] = useState('');
  const [selectedVoters, setSelectedVoters] = useState<string[]>([]);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!accessToken) router.replace('/login');
  }, [accessToken, router]);

  const { data: sessions = [], isLoading } = useQuery<Session[]>({
    queryKey: ['sessions', assocId],
    queryFn: async () => {
      const { data } = await voteApi.get(`/votes/sessions?associationId=${assocId}`);
      return data;
    },
    enabled: !!accessToken && !!assocId,
  });

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['association', assocId, 'members'],
    queryFn: async () => {
      const { data } = await assocApi.get(`/associations/${assocId}/members`);
      return data;
    },
    enabled: !!accessToken && !!assocId,
  });

  const { data: assoc } = useQuery<{ adminUserId: string; scAssocId: number | null }>({
    queryKey: ['association', assocId],
    queryFn: async () => {
      const { data } = await assocApi.get(`/associations/${assocId}`);
      return data;
    },
    enabled: !!accessToken && !!assocId,
  });

  const isAdmin = assoc?.adminUserId === user?.id;

  function toggleVoter(wallet: string) {
    setSelectedVoters((prev) =>
      prev.includes(wallet) ? prev.filter((w) => w !== wallet) : [...prev, wallet],
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!pemContent || !walletAddress) {
      setFormError('Load your PEM wallet first (Profile page).');
      return;
    }
    if (!assoc?.scAssocId) {
      setFormError('Association is not yet registered on-chain.');
      return;
    }
    const candidateList = candidates
      .split('\n')
      .map((c) => c.trim())
      .filter(Boolean);
    if (candidateList.length < 2) {
      setFormError('At least 2 candidates required.');
      return;
    }
    if (selectedVoters.length === 0) {
      setFormError('Select at least one eligible voter.');
      return;
    }

    setCreating(true);
    try {
      // 1. Create session draft in DB
      const deadlineTs = Math.floor(new Date(deadline).getTime() / 1000);
      const { data: session } = await voteApi.post('/votes/sessions', {
        associationId: assocId,
        title,
        deadline: deadlineTs,
        quorum,
        candidates: candidateList.map((name) => ({ name })),
        eligibleVoters: selectedVoters.map((wallet) => ({ walletAddress: wallet })),
      });

      // 2. Get unsigned tx from bridge
      const params = new URLSearchParams({
        assocId: String(assoc.scAssocId),
        sessionDbId: session.id,
        senderAddress: walletAddress,
      });
      const { data: unsignedTx } = await bridgeApi.get(`/bridge/tx/create-session?${params}`);

      // 3. Sign
      const signedTx = await signTx(pemContent, unsignedTx);

      // 4. Submit
      await bridgeApi.post('/bridge/tx/submit', { tx: signedTx, sessionId: session.id });

      setShowForm(false);
      setTitle('');
      setDeadline('');
      setCandidates('');
      setSelectedVoters([]);
      qc.invalidateQueries({ queryKey: ['sessions', assocId] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setFormError(typeof msg === 'string' ? msg : 'Failed to create session');
    } finally {
      setCreating(false);
    }
  }

  const statusColor: Record<string, string> = {
    draft: 'text-gray-400',
    open: 'text-green-600',
    stopped: 'text-amber-600',
    finalized: 'text-blue-600',
  };

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Link href={`/associations/${assocId}`} className="text-sm text-blue-600 hover:underline">
          ← Association
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-6">Voting Sessions</h1>

      {isAdmin && (
        <button
          onClick={() => setShowForm((v) => !v)}
          className="mb-6 bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ New session'}
        </button>
      )}

      {showForm && (
        <div className="bg-white rounded border border-gray-200 p-5 mb-8">
          <h2 className="font-medium mb-4">New voting session</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Deadline</label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                required
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Quorum (min votes)</label>
              <input
                type="number"
                min={1}
                value={quorum}
                onChange={(e) => setQuorum(Number(e.target.value))}
                required
                className="w-32 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Candidates <span className="font-normal text-gray-400">(one per line)</span>
              </label>
              <textarea
                value={candidates}
                onChange={(e) => setCandidates(e.target.value)}
                rows={4}
                required
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Eligible voters</label>
              {members.filter((m) => m.walletAddress).length === 0 ? (
                <p className="text-xs text-gray-400">No members with wallets linked.</p>
              ) : (
                <ul className="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded p-2">
                  {members
                    .filter((m) => m.walletAddress)
                    .map((m) => (
                      <li key={m.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedVoters.includes(m.walletAddress!)}
                          onChange={() => toggleVoter(m.walletAddress!)}
                          id={`voter-${m.id}`}
                        />
                        <label htmlFor={`voter-${m.id}`} className="cursor-pointer">
                          {m.user?.email ?? m.userId}
                          <span className="text-xs text-gray-400 ml-2 font-mono">
                            {m.walletAddress?.slice(0, 12)}…
                          </span>
                        </label>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <button
              type="submit"
              disabled={creating}
              className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create session'}
            </button>
          </form>
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="text-sm text-gray-500">No sessions yet.</p>
      ) : (
        <ul className="space-y-3">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={
                  s.status === 'finalized'
                    ? `/associations/${assocId}/sessions/${s.id}/results`
                    : `/associations/${assocId}/sessions/${s.id}`
                }
                className="block bg-white rounded border border-gray-200 px-5 py-4 hover:border-blue-400 transition-colors"
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">{s.title}</span>
                  <span className={`text-xs font-medium capitalize ${statusColor[s.status] ?? ''}`}>
                    {s.status}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Deadline: {new Date(Number(s.deadline) * 1000).toLocaleString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
