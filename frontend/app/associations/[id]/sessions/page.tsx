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
  scSessionId: string | null;
}

interface Member {
  id: string;
  userId: string;
  walletAddress: string | null;
  user?: { email: string };
}

interface Association {
  id: string;
  adminUserId: string;
  scAssocId: number | null;
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
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]); // wallet addresses
  const [selectedVoters, setSelectedVoters] = useState<string[]>([]); // wallet addresses
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

  const { data: assoc } = useQuery<Association>({
    queryKey: ['association', assocId],
    queryFn: async () => {
      const { data } = await assocApi.get(`/associations/${assocId}`);
      return data;
    },
    enabled: !!accessToken && !!assocId,
  });

  const isAdmin = assoc?.adminUserId === user?.id;

  // Members who have a linked wallet — usable as candidates or voters
  const membersWithWallet = members.filter((m) => m.walletAddress);

  function toggleCandidate(wallet: string) {
    setSelectedCandidates((prev) =>
      prev.includes(wallet) ? prev.filter((w) => w !== wallet) : [...prev, wallet],
    );
  }

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
    if (selectedCandidates.length < 2) {
      setFormError('Select at least 2 candidates.');
      return;
    }
    if (selectedVoters.length === 0) {
      setFormError('Select at least one eligible voter.');
      return;
    }

    setCreating(true);
    try {
      // Build candidate objects: { name, wallet } — name is the member's email
      const walletToEmail = new Map(
        membersWithWallet.map((m) => [m.walletAddress!, m.user?.email ?? m.userId]),
      );
      const candidateObjects = selectedCandidates.map((w) => ({
        name: walletToEmail.get(w) ?? w,
        wallet: w,
      }));

      // 1. Create session draft in DB
      const { data: session } = await voteApi.post('/votes/sessions', {
        associationId: assocId,
        title,
        deadline: new Date(deadline).toISOString(), // ISO 8601
        quorum,
        candidates: candidateObjects,
        eligibleVoters: selectedVoters.map((w) => ({ wallet: w })),
      });

      // 2. Get unsigned tx from bridge
      const deadlineTs = Math.floor(new Date(deadline).getTime() / 1000).toString();
      const { data: unsignedTx } = await bridgeApi.post('/bridge/tx/create-session', {
        scAssocId: String(assoc.scAssocId),
        title,
        deadlineTimestamp: deadlineTs,
        quorum: String(quorum),
        candidateWallets: selectedCandidates,
        eligibleVoterWallets: selectedVoters,
        senderAddress: walletAddress,
      });

      // 3. Sign
      const signedTx = await signTx(pemContent, unsignedTx);

      // 4. Submit — bridge broadcasts and async-patches scSessionId + status onto the session
      await bridgeApi.post('/bridge/tx/submit', {
        signedTx,
        sessionId: session.id,
        scAssocId: String(assoc.scAssocId),
      });

      setShowForm(false);
      setTitle('');
      setDeadline('');
      setSelectedCandidates([]);
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
    finalized: 'text-green-600',
  };

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Link href={`/associations/${assocId}`} className="text-sm text-green-600 hover:underline">
          ← Association
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-6">Voting Sessions</h1>

      {isAdmin && (
        <button
          onClick={() => setShowForm((v) => !v)}
          className="mb-6 bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700"
        >
          {showForm ? 'Cancel' : '+ New session'}
        </button>
      )}

      {showForm && (
        <div className="bg-white rounded border border-gray-200 p-5 mb-8">
          <h2 className="font-medium mb-4">New voting session</h2>

          {!pemContent && (
            <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4 text-sm text-amber-700">
              Load your PEM wallet on the{' '}
              <Link href="/profile" className="underline">
                Profile page
              </Link>{' '}
              to create sessions on-chain.
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            {/* Deadline */}
            <div>
              <label className="block text-sm font-medium mb-1">Deadline</label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                required
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            {/* Quorum */}
            <div>
              <label className="block text-sm font-medium mb-1">Quorum (min votes)</label>
              <input
                type="number"
                min={1}
                value={quorum}
                onChange={(e) => setQuorum(Number(e.target.value))}
                required
                className="w-32 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            {/* Candidates — selected from members with wallets */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Candidates{' '}
                <span className="font-normal text-gray-400">(select from members)</span>
              </label>
              {membersWithWallet.length === 0 ? (
                <p className="text-xs text-gray-400">No members with wallets linked.</p>
              ) : (
                <ul className="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded p-2">
                  {membersWithWallet.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        id={`cand-${m.id}`}
                        checked={selectedCandidates.includes(m.walletAddress!)}
                        onChange={() => toggleCandidate(m.walletAddress!)}
                      />
                      <label htmlFor={`cand-${m.id}`} className="cursor-pointer">
                        {m.user?.email ?? m.userId}
                        <span className="text-xs text-gray-400 ml-2 font-mono">
                          {m.walletAddress?.slice(0, 12)}…
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {selectedCandidates.length > 0 && (
                <p className="text-xs text-green-600 mt-1">
                  {selectedCandidates.length} candidate(s) selected
                </p>
              )}
            </div>

            {/* Eligible voters */}
            <div>
              <label className="block text-sm font-medium mb-2">Eligible voters</label>
              {membersWithWallet.length === 0 ? (
                <p className="text-xs text-gray-400">No members with wallets linked.</p>
              ) : (
                <ul className="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded p-2">
                  {membersWithWallet.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        id={`voter-${m.id}`}
                        checked={selectedVoters.includes(m.walletAddress!)}
                        onChange={() => toggleVoter(m.walletAddress!)}
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
              disabled={creating || !pemContent}
              className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
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
                className="block bg-white rounded border border-gray-200 px-5 py-4 hover:border-green-400 transition-colors"
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">{s.title}</span>
                  <span className={`text-xs font-medium capitalize ${statusColor[s.status] ?? ''}`}>
                    {s.status}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Deadline: {new Date(s.deadline).toLocaleString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
