'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { voteApi, assocApi, bridgeApi } from '@/lib/api';
import { formatLocalDateTime } from '@/lib/datetime';
import { useAuthStore } from '@/lib/store';
import { signTx } from '@/lib/wallet';

interface CandidateResult {
  id: string;
  name: string;
  wallet: string;
  voteCount: number;
}

interface SessionResults {
  session: {
    id: string;
    title: string;
    status: string;
    deadline: string;
    scSessionId: string | null;
    associationId: string;
    maxChoices: number;
  };
  candidates: CandidateResult[];
  winner: CandidateResult | null;
  totalVotes: number;
  totalVoted: number;
  totalEligible?: number;
  quorumReached: boolean;
}

interface Association {
  id: string;
  adminUserId: string;
  scAssocId: number | null;
}

export default function ResultsPage() {
  const router = useRouter();
  const { id: assocId, sessionId } = useParams<{ id: string; sessionId: string }>();
  const qc = useQueryClient();
  const { accessToken, pemContent, user, walletAddress } = useAuthStore();
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState('');
  const [closingEarly, setClosingEarly] = useState(false);
  const [closeEarlyError, setCloseEarlyError] = useState('');
  const autoFinalizeAttempted = useRef(false);

  useEffect(() => {
    if (!accessToken) router.replace('/login');
  }, [accessToken, router]);

  const { data: results, isLoading } = useQuery<SessionResults>({
    queryKey: ['session-results', sessionId],
    queryFn: async () => {
      const { data } = await voteApi.get(`/votes/sessions/${sessionId}/results`);
      return data;
    },
    enabled: !!accessToken && !!sessionId,
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
  const isFinalized = results?.session.status === 'finalized';
  const deadlinePassed = results ? new Date(results.session.deadline).getTime() <= Date.now() : false;
  const sessionStatus = results?.session.status ?? '';
  const canFinalize =
    !isFinalized &&
    !!assoc?.scAssocId &&
    !!results?.session.scSessionId &&
    (deadlinePassed || sessionStatus === 'stopped');

  const totalVotesPreview = results?.totalVoted ?? results?.totalVotes ?? 0;
  const totalEligiblePreview = results?.totalEligible ?? 0;
  const allEligibleVotedPreview =
    totalEligiblePreview > 0 && totalVotesPreview >= totalEligiblePreview;
  /** Show panel whenever admin could act; PEM only required to enable the button */
  const showEarlyClosePanel =
    isAdmin &&
    !isFinalized &&
    !deadlinePassed &&
    sessionStatus === 'open' &&
    allEligibleVotedPreview &&
    !!assoc?.scAssocId &&
    !!results?.session.scSessionId;
  const canSubmitEarlyClose = showEarlyClosePanel && !!pemContent && !!walletAddress;

  async function handleFinalize() {
    if (!assoc?.scAssocId || !results?.session.scSessionId) {
      setFinalizeError('Session or association not yet on-chain.');
      return;
    }
    setFinalizeError('');
    setFinalizing(true);
    try {
      const params = new URLSearchParams({
        scAssocId: String(assoc.scAssocId),
        scSessionId: String(results.session.scSessionId),
      });
      await bridgeApi.post(`/bridge/finalize/${sessionId}?${params}`);
      qc.invalidateQueries({ queryKey: ['session-results', sessionId] });
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setFinalizeError(typeof msg === 'string' ? msg : 'Finalization failed');
    } finally {
      setFinalizing(false);
    }
  }

  async function handleCloseVotingEarly() {
    if (!results || !assoc?.scAssocId || !results.session.scSessionId || !pemContent || !walletAddress) {
      return;
    }
    setCloseEarlyError('');
    setClosingEarly(true);
    try {
      const params = new URLSearchParams({
        scAssocId: String(assoc.scAssocId),
        scSessionId: String(results.session.scSessionId),
        senderAddress: walletAddress,
      });
      const { data: unsignedTx } = await bridgeApi.get(`/bridge/tx/stop-session?${params}`);
      const signedTx = await signTx(pemContent, unsignedTx);
      await bridgeApi.post('/bridge/tx/submit', {
        signedTx,
        sessionId: results.session.id,
        scAssocId: String(assoc.scAssocId),
        sessionSyncStatus: 'stopped',
      });
      await qc.invalidateQueries({ queryKey: ['session-results', sessionId] });
      await qc.invalidateQueries({ queryKey: ['session', sessionId] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setCloseEarlyError(typeof msg === 'string' ? msg : 'Could not close voting early');
    } finally {
      setClosingEarly(false);
    }
  }

  useEffect(() => {
    if (!canFinalize || finalizing || autoFinalizeAttempted.current) return;
    autoFinalizeAttempted.current = true;
    void handleFinalize();
  }, [canFinalize, finalizing]);

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!results) return <p className="text-sm text-red-600">Results not found.</p>;

  const totalVotes = results.totalVoted ?? results.totalVotes ?? 0;
  const totalEligible = results.totalEligible ?? 0;
  const allEligibleVoted = totalEligible > 0 && totalVotes >= totalEligible;
  const totalCandidateVotes = results.candidates.reduce((sum, c) => sum + c.voteCount, 0);
  const pieStops = results.candidates.reduce(
    (acc, candidate, index) => {
      const pct =
        totalCandidateVotes > 0 ? (candidate.voteCount / totalCandidateVotes) * 100 : 0;
      const start = acc.offset;
      const end = start + pct;
      const color = ['#16a34a', '#2563eb', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2'][index % 6];
      acc.parts.push(`${color} ${start}% ${end}%`);
      acc.offset = end;
      return acc;
    },
    { offset: 0, parts: [] as string[] },
  ).parts;
  const pieBackground =
    totalCandidateVotes > 0 ? `conic-gradient(${pieStops.join(', ')})` : '#e5e7eb';

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Link
          href={`/associations/${assocId}/sessions`}
          className="text-sm text-green-600 hover:underline"
        >
          ← Sessions
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-1">{results.session.title}</h1>
      <p className="text-xs text-gray-400 mb-6">
        Status: <span className="capitalize">{results.session.status}</span> | Deadline:{' '}
        {formatLocalDateTime(results.session.deadline)}
      </p>

      {!isFinalized && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 mb-6 text-sm text-amber-800">
          {deadlinePassed ? (
            <p>
              The deadline has passed. The app requests an on-chain{' '}
              <span className="font-mono text-xs bg-amber-100 px-1 rounded">finalizeSession</span>{' '}
              call; only after that succeeds is the session marked finalized and the official winner
              shown below.
            </p>
          ) : (
            <>
              <p>
                The official winner and &quot;Final results&quot; unlock only after on-chain
                finalization (same contract rule as above). Interim vote counts come from confirmed
                on-chain votes mirrored in the database.
              </p>
              {allEligibleVoted && (
                <p className="mt-2">
                  {isAdmin
                    ? 'To reveal the official winner before the deadline, use “Close voting now” below (on-chain stopSession, then finalizeSession). Your PEM must be the association admin wallet on MultiversX.'
                    : 'All eligible voters have voted. An association admin can close voting early from this results page, or you can wait until the deadline for automatic finalization.'}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold">{totalVotes}</p>
          <p className="text-xs text-gray-500">Votes cast</p>
        </div>
        <div className="bg-white rounded border border-gray-200 p-4 text-center">
          <p
            className={`text-sm font-medium ${results.quorumReached ? 'text-green-600' : 'text-red-500'}`}
          >
            {results.quorumReached ? 'Quorum reached' : 'Quorum not reached'}
          </p>
        </div>
        {results.winner && (
          <div className="bg-green-50 rounded border border-green-200 p-4 text-center">
            <p className="text-xs text-green-500 mb-1">Winner</p>
            <p className="font-semibold text-green-800">{results.winner.name}</p>
            <p className="text-xs text-green-500">{results.winner.voteCount} votes</p>
          </div>
        )}
      </div>

      {showEarlyClosePanel && (
        <div className="bg-white rounded border border-green-200 p-5 mb-6">
          <h2 className="font-medium mb-2">Close voting early</h2>
          <p className="text-sm text-gray-600 mb-4">
            Everyone eligible has voted. You can call{' '}
            <span className="font-mono text-xs bg-gray-100 px-1 rounded">stopSession</span> on the
            contract now, then the app will finalize on-chain and show the winner. Sign with the
            association admin PEM (same wallet as on-chain association admin).
          </p>
          {!pemContent && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3 mb-4">
              Load your admin PEM on the{' '}
              <Link href="/profile" className="underline font-medium">
                Profile
              </Link>{' '}
              page — the button stays disabled until a wallet is loaded for signing.
            </p>
          )}
          <button
            type="button"
            onClick={() => void handleCloseVotingEarly()}
            disabled={closingEarly || finalizing || !canSubmitEarlyClose}
            className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {closingEarly ? 'Closing…' : 'Close voting now'}
          </button>
          {closeEarlyError && <p className="text-sm text-red-600 mt-2">{closeEarlyError}</p>}
        </div>
      )}

      {sessionStatus === 'stopped' && !isFinalized && (
        <p className="text-sm text-gray-600 mb-4">
          Voting is stopped on-chain. Final results load automatically when{' '}
          <span className="font-mono text-xs bg-gray-100 px-1 rounded">finalizeSession</span>{' '}
          completes.
        </p>
      )}

      {isFinalized && (
        <div className="bg-white rounded border border-gray-200 p-5 mb-6">
          <h2 className="font-medium mb-4">Final results</h2>
          <div className="flex flex-col md:flex-row md:items-center gap-8">
            <div
              className="h-56 w-56 rounded-full border border-gray-200 shrink-0"
              style={{ background: pieBackground }}
              aria-label="Final vote distribution pie chart"
            />
            <ul className="space-y-3 flex-1">
              {results.candidates.map((c, i) => {
                const pct =
                  totalCandidateVotes > 0 ? (c.voteCount / totalCandidateVotes) * 100 : 0;
                const color = ['#16a34a', '#2563eb', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2'][
                  i % 6
                ];
                return (
                  <li key={c.id} className="flex items-center justify-between gap-4 text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-sm"
                        style={{ backgroundColor: color }}
                      />
                      <span className={i === 0 ? 'font-semibold' : ''}>{c.name}</span>
                    </span>
                    <span className="text-gray-500">
                      {c.voteCount} votes ({pct.toFixed(1)}%)
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Finalize button */}
      {canFinalize && (
        <div>
          <button
            onClick={handleFinalize}
            disabled={finalizing}
            className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {finalizing ? 'Loading final result...' : 'Get final results'}
          </button>
          {finalizeError && <p className="text-sm text-red-600 mt-2">{finalizeError}</p>}
        </div>
      )}

      {!isFinalized && !canFinalize && !showEarlyClosePanel && (
        <p className="text-xs text-gray-400">
          {!deadlinePassed
            ? 'On-chain finalization runs after the deadline, or sooner if an admin uses “Close voting now” when everyone has voted. Then the bridge syncs status and the winner appears here.'
            : !assoc?.scAssocId || !results.session.scSessionId
              ? 'Session must be on-chain before finalizing.'
              : 'Finalization is not available yet.'}
        </p>
      )}
    </div>
  );
}
