'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { assocApi, voteApi, bridgeApi } from '@/lib/api';
import { formatLocalDateTime, parseLocalDateTimeInput } from '@/lib/datetime';
import { useAuthStore } from '@/lib/store';
import { signTx } from '@/lib/wallet';

interface Session {
  id: string;
  title: string;
  status: string;
  deadline: string;
  scSessionId: string | null;
  maxChoices: number;
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
  adminWallet: string | null;
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
  const [maxChoices, setMaxChoices] = useState(1);
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]); // wallet addresses
  const [selectedVoters, setSelectedVoters] = useState<string[]>([]); // wallet addresses
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  const memberOptions = members
    .filter((m) => m.walletAddress)
    .map((m) => ({
      id: m.id,
      userId: m.userId,
      walletAddress: m.walletAddress!,
      label: m.user?.email ?? m.userId,
    }));
  const adminWallet = isAdmin ? walletAddress ?? assoc?.adminWallet : null;
  const adminOption =
    adminWallet && !memberOptions.some((m) => m.walletAddress === adminWallet)
      ? [
          {
            id: 'admin',
            userId: user?.id ?? 'admin',
            walletAddress: adminWallet,
            label: `${user?.email ?? 'Admin'} (admin)`,
          },
        ]
      : [];
  const votingOptions = [...adminOption, ...memberOptions];

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

  function setAllCandidates(selected: boolean) {
    setSelectedCandidates(selected ? votingOptions.map((m) => m.walletAddress) : []);
  }

  function setAllVoters(selected: boolean) {
    setSelectedVoters(selected ? votingOptions.map((m) => m.walletAddress) : []);
  }

  async function handleDeleteSession(sessionId: string) {
    setActionError('');
    setDeletingId(sessionId);
    try {
      await voteApi.delete(`/votes/sessions/${sessionId}`);
      qc.invalidateQueries({ queryKey: ['sessions', assocId] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setActionError(typeof msg === 'string' ? msg : 'Failed to delete session');
    } finally {
      setDeletingId(null);
    }
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
    if (maxChoices > selectedCandidates.length) {
      setFormError('The max number of choices cannot exceed the number of candidates.');
      return;
    }
    if (selectedVoters.length === 0) {
      setFormError('Select at least one eligible voter.');
      return;
    }

    setCreating(true);
    try {
      const parsedDeadline = parseLocalDateTimeInput(deadline);
      // Build candidate objects: { name, wallet } — name is the member's email
      const walletToEmail = new Map(votingOptions.map((m) => [m.walletAddress, m.label]));
      const candidateObjects = selectedCandidates.map((w) => ({
        name: walletToEmail.get(w) ?? w,
        wallet: w,
      }));

      // 1. Create session draft in DB
      const { data: session } = await voteApi.post('/votes/sessions', {
        associationId: assocId,
        title,
        deadline: parsedDeadline.toISOString(),
        quorum,
        maxChoices,
        candidates: candidateObjects,
        eligibleVoters: selectedVoters.map((w) => ({ wallet: w })),
      });

      // 2. Get unsigned tx from bridge
      const deadlineTs = Math.floor(parsedDeadline.getTime() / 1000).toString();
      const { data: unsignedTx } = await bridgeApi.post('/bridge/tx/create-session', {
        scAssocId: String(assoc.scAssocId),
        title,
        deadlineTimestamp: deadlineTs,
        quorum: String(quorum),
        maxChoices: String(maxChoices),
        candidateWallets: selectedCandidates,
        eligibleVoterWallets: selectedVoters,
        senderAddress: walletAddress,
      });

      // 3. Sign
      const signedTx = await signTx(pemContent, unsignedTx);

      // 4. Submit — bridge broadcasts and async-patches scSessionId + status onto the session
      const { data: submitResult } = await bridgeApi.post('/bridge/tx/submit', {
        signedTx,
        sessionId: session.id,
        scAssocId: String(assoc.scAssocId),
      });

      if (submitResult?.scSessionId) {
        await voteApi.patch(`/votes/sessions/${session.id}`, {
          scSessionId: String(submitResult.scSessionId),
          status: 'open',
        });
      }

      setShowForm(false);
      setTitle('');
      setDeadline('');
      setQuorum(1);
      setMaxChoices(1);
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
              <label className="block text-sm font-medium mb-1">Minimum votes for a valid result</label>
              <input
                type="number"
                min={1}
                value={quorum}
                onChange={(e) => setQuorum(Number(e.target.value))}
                required
                className="w-32 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-xs text-gray-500 mt-1 max-w-xl">
                The result only counts if at least this many eligible voters submit a vote. If fewer people vote, the session can be finalized but it will have no valid winner.
              </p>
            </div>

            {/* Choice mode */}
            <div>
              <label className="block text-sm font-medium mb-2">Vote type</label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMaxChoices(1)}
                  className={`rounded border px-3 py-2 text-sm ${
                    maxChoices === 1
                      ? 'border-green-600 bg-green-50 text-green-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Single choice
                </button>
                <button
                  type="button"
                  onClick={() => setMaxChoices(2)}
                  className={`rounded border px-3 py-2 text-sm ${
                    maxChoices > 1
                      ? 'border-green-600 bg-green-50 text-green-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Multiple choice
                </button>
              </div>
              {maxChoices > 1 && (
                <div className="mt-3">
                  <label className="block text-xs text-gray-500 mb-1">Maximum selections</label>
                  <input
                    type="number"
                    min={2}
                    max={Math.max(2, selectedCandidates.length)}
                    value={maxChoices}
                    onChange={(e) => setMaxChoices(Number(e.target.value))}
                    className="w-32 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              )}
            </div>

            {/* Candidates — selected from members with wallets */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="block text-sm font-medium">
                  Candidates{' '}
                  <span className="font-normal text-gray-400">(select from members)</span>
                </label>
                {votingOptions.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setAllCandidates(selectedCandidates.length !== votingOptions.length)
                    }
                    className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {selectedCandidates.length === votingOptions.length ? 'Clear all' : 'Select all'}
                  </button>
                )}
              </div>
              {votingOptions.length === 0 ? (
                <p className="text-xs text-gray-400">No members with wallets linked.</p>
              ) : (
                <ul className="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded p-2">
                  {votingOptions.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        id={`cand-${m.id}`}
                        checked={selectedCandidates.includes(m.walletAddress)}
                        onChange={() => toggleCandidate(m.walletAddress)}
                      />
                      <label htmlFor={`cand-${m.id}`} className="cursor-pointer">
                        {m.label}
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
              <div className="mb-2 flex items-center justify-between gap-3">
                <label className="block text-sm font-medium">Eligible voters</label>
                {votingOptions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAllVoters(selectedVoters.length !== votingOptions.length)}
                    className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {selectedVoters.length === votingOptions.length ? 'Clear all' : 'Select all'}
                  </button>
                )}
              </div>
              {votingOptions.length === 0 ? (
                <p className="text-xs text-gray-400">No members with wallets linked.</p>
              ) : (
                <ul className="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded p-2">
                  {votingOptions.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        id={`voter-${m.id}`}
                        checked={selectedVoters.includes(m.walletAddress)}
                        onChange={() => toggleVoter(m.walletAddress)}
                      />
                      <label htmlFor={`voter-${m.id}`} className="cursor-pointer">
                        {m.label}
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
        <>
        {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}
        <ul className="space-y-3">
          {sessions.map((s) => (
            (() => {
              const deadlinePassed = new Date(s.deadline).getTime() <= Date.now();
              const targetHref =
                s.status === 'finalized' ||
                s.status === 'stopped' ||
                (s.scSessionId && deadlinePassed)
                  ? `/associations/${assocId}/sessions/${s.id}/results`
                  : `/associations/${assocId}/sessions/${s.id}`;

              return (
            <li
              key={s.id}
              className="bg-white rounded border border-gray-200 px-5 py-4 hover:border-green-400 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <Link
                  href={targetHref}
                  className="min-w-0 flex-1"
                >
                  <div className="flex justify-between items-center gap-3">
                    <span className="font-medium">{s.title}</span>
                    <span
                      className={`text-xs font-medium capitalize ${statusColor[s.status] ?? ''}`}
                    >
                      {s.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Deadline: {formatLocalDateTime(s.deadline)}
                  </p>
                  {!s.scSessionId && (
                    <p className="text-xs text-amber-600 mt-1">
                      Not published on-chain yet. Voting will be available after the on-chain transaction is confirmed.
                    </p>
                  )}
                  {s.scSessionId && s.status === 'stopped' && (
                    <p className="text-xs text-amber-600 mt-1">
                      Voting closed early. Open the results page to finalize on-chain and load the winner.
                    </p>
                  )}
                  {s.scSessionId &&
                    deadlinePassed &&
                    s.status !== 'finalized' &&
                    s.status !== 'stopped' && (
                    <p className="text-xs text-amber-600 mt-1">
                      Deadline passed. Open the results page to load the final result.
                    </p>
                  )}
                </Link>
                {isAdmin && !s.scSessionId && (
                  <button
                    type="button"
                    onClick={() => handleDeleteSession(s.id)}
                    disabled={deletingId === s.id}
                    className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {deletingId === s.id ? 'Deleting...' : 'Delete'}
                  </button>
                )}
              </div>
            </li>
              );
            })()
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
