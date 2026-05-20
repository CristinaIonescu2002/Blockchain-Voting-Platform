'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { voteApi, assocApi, bridgeApi } from '@/lib/api';
import { formatLocalDateTime } from '@/lib/datetime';
import { useAuthStore } from '@/lib/store';
import { signTx, signVoteIntent } from '@/lib/wallet';

interface Candidate {
  id: string;
  name: string;
  wallet: string;
  voteCount: number;
}

interface EligibleVoter {
  wallet: string;
  hasVoted: boolean;
  userId?: string | null;
}

interface Session {
  id: string;
  title: string;
  status: string;
  deadline: string;
  scSessionId: string | null;
  associationId: string;
  maxChoices: number;
  candidates: Candidate[];
  eligibleVoters: EligibleVoter[];
}

interface Association {
  id: string;
  scAssocId: number | null;
  adminUserId: string;
}

export default function VotePage() {
  const router = useRouter();
  const { id: assocId, sessionId } = useParams<{ id: string; sessionId: string }>();
  const qc = useQueryClient();
  const { accessToken, walletAddress, pemContent, user } = useAuthStore();
  const [voting, setVoting] = useState(false);
  const [voted, setVoted] = useState(false);
  const [voteError, setVoteError] = useState('');
  const [selectedWallets, setSelectedWallets] = useState<string[]>([]);
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [closingEarly, setClosingEarly] = useState(false);
  const [closeEarlyError, setCloseEarlyError] = useState('');

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

  const { data: assoc } = useQuery<Association>({
    queryKey: ['association', assocId],
    queryFn: async () => {
      const { data } = await assocApi.get(`/associations/${assocId}`);
      return data;
    },
    enabled: !!accessToken && !!assocId,
  });

  function toggleCandidate(wallet: string) {
    setSelectedWallets((prev) => {
      if (prev.includes(wallet)) return prev.filter((w) => w !== wallet);
      if (prev.length >= (session?.maxChoices ?? 1)) return prev;
      return [...prev, wallet];
    });
  }

  async function handleVote(candidateWallets: string[]) {
    setVoteError('');
    if (!session?.scSessionId) {
      setVoteError('This voting session is not published on-chain yet.');
      return;
    }
    if (!pemContent || !walletAddress) {
      setVoteError('Load your PEM wallet first (Profile page).');
      return;
    }
    if (!assoc?.scAssocId) {
      setVoteError('Association is not yet on-chain.');
      return;
    }
    if (candidateWallets.length === 0) {
      setVoteError('Select at least one option.');
      return;
    }
    if (candidateWallets.length > session.maxChoices) {
      setVoteError(`Select at most ${session.maxChoices} option(s).`);
      return;
    }

    setVoting(true);
    try {
      const voteIntent = {
        scAssocId: String(assoc.scAssocId),
        scSessionId: String(session.scSessionId),
        voterWallet: walletAddress,
        candidateWallets,
      };
      const signedIntent = await signVoteIntent(pemContent, voteIntent);

      await bridgeApi.post('/bridge/tx/vote/submit-intent', {
        associationId: assocId,
        sessionId: session.id,
        ...voteIntent,
        ...signedIntent,
      });

      setVoted(true);
      setShowVoteModal(false);
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setVoteError(typeof msg === 'string' ? msg : 'Vote failed');
    } finally {
      setVoting(false);
    }
  }

  async function handleCloseVotingEarly() {
    if (!session?.scSessionId || !assoc?.scAssocId || !pemContent || !walletAddress) return;
    setCloseEarlyError('');
    setClosingEarly(true);
    try {
      const params = new URLSearchParams({
        scAssocId: String(assoc.scAssocId),
        scSessionId: String(session.scSessionId),
        senderAddress: walletAddress,
      });
      const { data: unsignedTx } = await bridgeApi.get(`/bridge/tx/stop-session?${params}`);
      const signedTx = await signTx(pemContent, unsignedTx);
      await bridgeApi.post('/bridge/tx/submit', {
        signedTx,
        sessionId: session.id,
        scAssocId: String(assoc.scAssocId),
        sessionSyncStatus: 'stopped',
      });
      await qc.invalidateQueries({ queryKey: ['session', sessionId] });
      await qc.invalidateQueries({ queryKey: ['session-results', sessionId] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setCloseEarlyError(typeof msg === 'string' ? msg : 'Could not close voting early');
    } finally {
      setClosingEarly(false);
    }
  }

  if (isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!session) return <p className="text-sm text-red-600">Session not found.</p>;

  const isOnChain = !!session.scSessionId;
  const isOpen = session.status === 'open' && isOnChain;
  const deadline = new Date(session.deadline);
  const deadlinePassed = deadline.getTime() <= Date.now();
  const currentVoter = session.eligibleVoters?.find((v) => v.wallet === walletAddress);
  const hasAlreadyVoted = voted || !!currentVoter?.hasVoted;
  const canSelectMultiple = session.maxChoices > 1;
  const isFinalized = session.status === 'finalized';
  const isAdmin = assoc?.adminUserId === user?.id;
  const eligibleList = session.eligibleVoters ?? [];
  const allEligibleVoted =
    eligibleList.length > 0 && eligibleList.every((v) => v.hasVoted);
  const showEarlyClosePanel =
    isAdmin &&
    isOpen &&
    !deadlinePassed &&
    !isFinalized &&
    allEligibleVoted &&
    !!assoc?.scAssocId &&
    !!session.scSessionId;
  const canSubmitEarlyClose = showEarlyClosePanel && !!pemContent && !!walletAddress;
  const canVote =
    isOpen && !deadlinePassed && !!currentVoter && !hasAlreadyVoted && !!pemContent;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Link
          href={`/associations/${assocId}/sessions`}
          className="text-sm text-green-600 hover:underline"
        >
          Back to sessions
        </Link>
      </div>

      <h1 className="text-2xl font-semibold mb-1">{session.title}</h1>
      <p className="text-xs text-gray-400 mb-6">
        Status: <span className="capitalize">{session.status}</span> | Deadline:{' '}
        {formatLocalDateTime(deadline)}
      </p>

      {session.status === 'stopped' && !isFinalized && isOnChain && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 mb-5 text-sm text-amber-800">
          Voting was closed early on-chain. Open the results page to load the final on-chain result.
          <div className="mt-3">
            <Link
              href={`/associations/${assocId}/sessions/${sessionId}/results`}
              className="inline-block rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Open results
            </Link>
          </div>
        </div>
      )}

      {deadlinePassed && !isFinalized && isOnChain && session.status !== 'stopped' && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 mb-5 text-sm text-amber-800">
          The voting deadline has passed. No more votes can be submitted. You can open the results page to finalize the session and load the final result.
          <div className="mt-3">
            <Link
              href={`/associations/${assocId}/sessions/${sessionId}/results`}
              className="inline-block rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Open results
            </Link>
          </div>
        </div>
      )}

      {!isOnChain && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 mb-5 text-sm text-amber-800">
          This voting session is not published on-chain yet. Voting will be available after the on-chain transaction is confirmed.
        </div>
      )}

      {session.status === 'finalized' && isOnChain && (
        <Link
          href={`/associations/${assocId}/sessions/${sessionId}/results`}
          className="inline-block mb-6 bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700"
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

      <div className="bg-white rounded border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="font-medium">Voting options</h2>
            <p className="text-xs text-gray-500 mt-1">
              {canSelectMultiple
                ? `This is a multiple-choice vote. You can select up to ${session.maxChoices} option(s).`
                : 'This is a single-choice vote. You can select one option.'}
            </p>
          </div>
          {isOpen && currentVoter && !hasAlreadyVoted && !deadlinePassed && (
            <button
              onClick={() => {
                setVoteError('');
                setSelectedWallets([]);
                setShowVoteModal(true);
              }}
              disabled={!pemContent}
              className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              Vote
            </button>
          )}
        </div>

        <ul className="divide-y divide-gray-100">
          {session.candidates.map((candidate) => (
            <li key={candidate.id} className="py-3">
              <p className="font-medium">{candidate.name}</p>
              <p className="text-xs text-gray-400 font-mono">{candidate.wallet.slice(0, 16)}...</p>
            </li>
          ))}
        </ul>
      </div>

      {isAdmin && (
        <div className="bg-white rounded border border-gray-200 p-5 mb-6">
          <h2 className="font-medium mb-4">Voting status</h2>
          <ul className="divide-y divide-gray-100">
            {session.eligibleVoters.map((voter) => (
              <li key={voter.wallet} className="py-3 flex items-center justify-between gap-4">
                <span className="text-sm font-mono break-all">{voter.wallet}</span>
                <span
                  className={`text-xs font-medium ${
                    voter.hasVoted ? 'text-green-600' : 'text-amber-600'
                  }`}
                >
                  {voter.hasVoted ? 'Voted' : 'Not voted'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showEarlyClosePanel && (
        <div className="bg-white rounded border border-green-200 p-5 mb-6">
          <h2 className="font-medium mb-2">Close voting early</h2>
          <p className="text-sm text-gray-600 mb-4">
            Every eligible voter has voted before the deadline. As association admin you can call{' '}
            <span className="font-mono text-xs bg-gray-100 px-1 rounded">stopSession</span> on-chain,
            then open Results — the app will run <span className="font-mono text-xs bg-gray-100 px-1 rounded">finalizeSession</span>{' '}
            and show the official winner. Use the PEM for the same wallet that is admin on-chain.
          </p>
          {!pemContent && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3 mb-4">
              Load your admin PEM on the{' '}
              <Link href="/profile" className="underline font-medium">
                Profile
              </Link>{' '}
              page to enable signing.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleCloseVotingEarly()}
              disabled={closingEarly || !canSubmitEarlyClose}
              className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {closingEarly ? 'Closing…' : 'Close voting now'}
            </button>
            <Link
              href={`/associations/${assocId}/sessions/${sessionId}/results`}
              className="text-sm text-green-700 underline"
            >
              Open results page
            </Link>
          </div>
          {closeEarlyError && <p className="text-sm text-red-600 mt-2">{closeEarlyError}</p>}
        </div>
      )}

      {hasAlreadyVoted && !isFinalized && (
        <div className="bg-green-50 border border-green-200 rounded p-4 text-green-700 text-sm">
          <p>
            Your vote has been submitted. Final rankings and winner appear after on-chain{' '}
            <span className="font-mono text-xs bg-green-100 px-1 rounded">finalizeSession</span>{' '}
            (when the deadline passes, or sooner if an admin closes voting early above).
          </p>
          <div className="mt-3 flex flex-wrap gap-3 items-center">
            <Link
              href={`/associations/${assocId}/sessions/${sessionId}/results`}
              className="inline-block rounded bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-800"
            >
              Go to results
            </Link>
            {isAdmin && allEligibleVoted && showEarlyClosePanel && (
              <span className="text-xs text-green-800">
                Admin: use &quot;Close voting now&quot; above if the deadline has not passed yet.
              </span>
            )}
          </div>
        </div>
      )}

      {!currentVoter && isOpen && (
        <div className="bg-amber-50 border border-amber-200 rounded p-4 text-amber-700 text-sm">
          Your loaded wallet is not eligible to vote in this session.
        </div>
      )}

      {deadlinePassed && !isFinalized && (
        <div className="bg-gray-50 border border-gray-200 rounded p-4 text-gray-700 text-sm">
          This session is still marked as open in the app, but the deadline is already past, so the smart contract will reject any new vote with `Session deadline has passed` until the session is finalized.
        </div>
      )}

      {showVoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="font-semibold">Cast your vote</h2>
                <p className="text-xs text-gray-500 mt-1">
                  {canSelectMultiple
                    ? `Select up to ${session.maxChoices} option(s).`
                    : 'Select one option.'}
                </p>
              </div>
              <button
                onClick={() => setShowVoteModal(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Close
              </button>
            </div>

            <ul className="space-y-2 max-h-80 overflow-y-auto">
              {session.candidates.map((candidate) => (
                <li key={candidate.id}>
                  <label className="flex items-center gap-3 rounded border border-gray-200 px-3 py-3 text-sm cursor-pointer hover:bg-gray-50">
                    <input
                      type={canSelectMultiple ? 'checkbox' : 'radio'}
                      name="vote-option"
                      checked={selectedWallets.includes(candidate.wallet)}
                      disabled={
                        voting ||
                        (canSelectMultiple &&
                          !selectedWallets.includes(candidate.wallet) &&
                          selectedWallets.length >= session.maxChoices)
                      }
                      onChange={() => {
                        if (canSelectMultiple) {
                          toggleCandidate(candidate.wallet);
                        } else {
                          setSelectedWallets([candidate.wallet]);
                        }
                      }}
                    />
                    <span>
                      <span className="block font-medium">{candidate.name}</span>
                      <span className="block text-xs text-gray-400 font-mono">
                        {candidate.wallet.slice(0, 16)}...
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="mt-5 flex items-center justify-between gap-4">
              <p className="text-xs text-gray-500">
                {selectedWallets.length}/{session.maxChoices} selected
              </p>
              <button
                onClick={() => handleVote(selectedWallets)}
                disabled={!canVote || voting || selectedWallets.length === 0}
                className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {voting ? 'Submitting...' : 'Submit vote'}
              </button>
            </div>
          </div>
        </div>
      )}

      {voteError && <p className="text-sm text-red-600 mt-4">{voteError}</p>}
    </div>
  );
}
