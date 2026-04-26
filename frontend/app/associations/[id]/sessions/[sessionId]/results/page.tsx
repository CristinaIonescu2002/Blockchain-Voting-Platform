'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { voteApi, assocApi, bridgeApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface CandidateResult {
  id: string;
  name: string;
  voteCount: number;
}

interface SessionResults {
  session: {
    id: string;
    title: string;
    status: string;
    deadline: string;
  };
  candidates: CandidateResult[];
  winner: CandidateResult | null;
  totalVotes: number;
  quorumReached: boolean;
}

export default function ResultsPage() {
  const router = useRouter();
  const { id: assocId, sessionId } = useParams<{ id: string; sessionId: string }>();
  const qc = useQueryClient();
  const { accessToken, user } = useAuthStore();
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState('');

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

  const { data: assoc } = useQuery<{ adminUserId: string }>({
    queryKey: ['association', assocId],
    queryFn: async () => {
      const { data } = await assocApi.get(`/associations/${assocId}`);
      return data;
    },
    enabled: !!accessToken && !!assocId,
  });

  const isAdmin = assoc?.adminUserId === user?.id;
  const isFinalized = results?.session.status === 'finalized';
  const canFinalize = isAdmin && !isFinalized;

  async function handleFinalize() {
    setFinalizeError('');
    setFinalizing(true);
    try {
      await bridgeApi.post(`/bridge/finalize/${sessionId}`);
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

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!results) return <p className="text-sm text-red-600">Results not found.</p>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Link
          href={`/associations/${assocId}/sessions`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Sessions
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-1">{results.session.title}</h1>
      <p className="text-xs text-gray-400 mb-6 capitalize">{results.session.status}</p>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold">{results.totalVotes}</p>
          <p className="text-xs text-gray-500">Total votes</p>
        </div>
        <div className="bg-white rounded border border-gray-200 p-4 text-center">
          <p className={`text-sm font-medium ${results.quorumReached ? 'text-green-600' : 'text-red-500'}`}>
            {results.quorumReached ? 'Quorum reached' : 'Quorum not reached'}
          </p>
        </div>
        {results.winner && (
          <div className="bg-blue-50 rounded border border-blue-200 p-4 text-center">
            <p className="text-xs text-blue-500 mb-1">Winner</p>
            <p className="font-semibold text-blue-800">{results.winner.name}</p>
            <p className="text-xs text-blue-500">{results.winner.voteCount} votes</p>
          </div>
        )}
      </div>

      {/* Candidate breakdown */}
      <div className="bg-white rounded border border-gray-200 p-5 mb-6">
        <h2 className="font-medium mb-4">Vote breakdown</h2>
        <ul className="space-y-3">
          {results.candidates.map((c, i) => {
            const pct = results.totalVotes > 0 ? (c.voteCount / results.totalVotes) * 100 : 0;
            return (
              <li key={c.id}>
                <div className="flex justify-between text-sm mb-1">
                  <span className={i === 0 && isFinalized ? 'font-semibold' : ''}>{c.name}</span>
                  <span className="text-gray-500">{c.voteCount} votes ({pct.toFixed(1)}%)</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Finalize button (admin only, not yet finalized) */}
      {canFinalize && (
        <div>
          <button
            onClick={handleFinalize}
            disabled={finalizing}
            className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {finalizing ? 'Finalizing…' : 'Finalize session on-chain'}
          </button>
          {finalizeError && <p className="text-sm text-red-600 mt-2">{finalizeError}</p>}
        </div>
      )}
    </div>
  );
}
