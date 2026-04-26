'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { voteApi, bridgeApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { signTx } from '@/lib/wallet';

interface Candidate {
  id: string;
  name: string;
  candidateIndex: number;
  voteCount: number;
}

interface Session {
  id: string;
  title: string;
  status: string;
  deadline: string;
  scSessionId: number | null;
  associationId: string;
  candidates: Candidate[];
}

export default function VotePage() {
  const router = useRouter();
  const { id: assocId, sessionId } = useParams<{ id: string; sessionId: string }>();
  const { accessToken, walletAddress, pemContent } = useAuthStore();
  const [voting, setVoting] = useState(false);
  const [voted, setVoted] = useState(false);
  const [voteError, setVoteError] = useState('');

  useEffect(() => {
    if (!accessToken) router.replace('/login');
  }, [accessToken, router]);

  const { data: session, isLoading } = useQuery<Session>({
    queryKey: ['session', sessionId],
    queryFn: async () => {
      const { data } = await voteApi.get(`/votes/sessions/${sessionId}`);
      return data;
    },
    enabled: !!accessToken && !!sessionId,
  });

  async function handleVote(candidateIndex: number) {
    setVoteError('');
    if (!pemContent || !walletAddress) {
      setVoteError('Load your PEM wallet first (Profile page).');
      return;
    }
    if (!session?.scSessionId) {
      setVoteError('Session is not yet on-chain.');
      return;
    }
    setVoting(true);
    try {
      // 1. Get unsigned inner tx from bridge
      const params = new URLSearchParams({
        sessionId: String(session.scSessionId),
        candidateIndex: String(candidateIndex),
        voterAddress: walletAddress,
        assocId: String(0), // bridge will look up scAssocId
        sessionDbId: session.id,
      });
      const { data: unsignedTx } = await bridgeApi.get(`/bridge/tx/vote?${params}`);

      // 2. Sign inner tx
      const signedTx = await signTx(pemContent, unsignedTx);

      // 3. Submit (relayed — bridge pays gas)
      await bridgeApi.post('/bridge/tx/vote/submit', {
        tx: signedTx,
        sessionId: session.id,
        voterAddress: walletAddress,
      });

      setVoted(true);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setVoteError(typeof msg === 'string' ? msg : 'Vote failed');
    } finally {
      setVoting(false);
    }
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!session) return <p className="text-sm text-red-600">Session not found.</p>;

  const isOpen = session.status === 'open';
  const deadline = new Date(Number(session.deadline) * 1000);

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
      <h1 className="text-2xl font-semibold mb-1">{session.title}</h1>
      <p className="text-xs text-gray-400 mb-6">
        Status: <span className="capitalize">{session.status}</span> · Deadline:{' '}
        {deadline.toLocaleString()}
      </p>

      {session.status === 'finalized' && (
        <Link
          href={`/associations/${assocId}/sessions/${sessionId}/results`}
          className="inline-block mb-6 bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          View results
        </Link>
      )}

      {!pemContent && isOpen && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-5 text-sm text-amber-700">
          Load your PEM wallet on the{' '}
          <Link href="/profile" className="underline">
            Profile page
          </Link>{' '}
          to vote.
        </div>
      )}

      {voted ? (
        <div className="bg-green-50 border border-green-200 rounded p-4 text-green-700 text-sm">
          Your vote has been submitted. It will be confirmed on-chain shortly.
        </div>
      ) : (
        <div className="space-y-3">
          {session.candidates.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded border border-gray-200 px-5 py-4 flex items-center justify-between"
            >
              <span className="font-medium">{c.name}</span>
              {isOpen && (
                <button
                  onClick={() => handleVote(c.candidateIndex)}
                  disabled={voting}
                  className="bg-blue-600 text-white rounded px-4 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {voting ? 'Submitting…' : 'Vote'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {voteError && <p className="text-sm text-red-600 mt-4">{voteError}</p>}
    </div>
  );
}
