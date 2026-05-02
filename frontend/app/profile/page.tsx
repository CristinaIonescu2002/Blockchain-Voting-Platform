'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { authApi } from '@/lib/api';
import { parsePem } from '@/lib/wallet';

export default function ProfilePage() {
  const router = useRouter();
  const { user, accessToken, walletAddress, pemContent, setUser, setPem, clearPem } =
    useAuthStore();
  const [showPicker, setShowPicker] = useState(false);
  const [pemFile, setPemFile] = useState<File | null>(null);
  const [pemError, setPemError] = useState('');
  const [linking, setLinking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!accessToken) router.replace('/login');
  }, [accessToken, router]);

  if (!user) return null;

  async function handleLinkWallet() {
    if (!pemFile) return;
    setPemError('');
    setLinking(true);
    try {
      const text = await pemFile.text();
      const { address } = parsePem(text);
      await authApi.post('/auth/link-wallet', { walletAddress: address });
      setPem(text, address);
      setUser({ ...user!, walletAddress: address });
      setPemFile(null);
      setShowPicker(false);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setPemError(typeof msg === 'string' ? msg : 'Failed to link wallet');
    } finally {
      setLinking(false);
    }
  }

  // 4 wallet states:
  //   A) pemContent set         → loaded indicator + "Clear" button
  //   B) file selected          → file name + "Link Wallet" + "Remove"
  //   C) picker open, no file   → file input + "Cancel"
  //   D) default                → "Add Wallet" button only

  function renderWalletSection() {
    if (pemContent) {
      // State A — PEM active in memory
      return (
        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded px-4 py-3">
          <div>
            <p className="text-sm font-medium text-green-700">Wallet loaded in memory</p>
            <p className="text-xs text-green-600 font-mono mt-0.5 break-all">
              {walletAddress}
            </p>
          </div>
          <button
            onClick={clearPem}
            className="ml-4 text-xs text-red-500 hover:underline shrink-0"
          >
            Clear
          </button>
        </div>
      );
    }

    if (pemFile) {
      // State B — file chosen, waiting for "Link Wallet"
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700 font-medium">{pemFile.name}</span>
            <button
              onClick={() => {
                setPemFile(null);
                setPemError('');
              }}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors"
            >
              ✕ Remove
            </button>
          </div>
          {pemError && <p className="text-sm text-red-600">{pemError}</p>}
          <button
            onClick={handleLinkWallet}
            disabled={linking}
            className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {linking ? 'Linking…' : 'Link Wallet'}
          </button>
        </div>
      );
    }

    if (showPicker) {
      // State C — picker revealed, no file yet
      return (
        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pem"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setPemFile(f);
            }}
            className="text-sm text-gray-600 block file:mr-3 file:rounded file:border-0 file:bg-green-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-green-700 file:cursor-pointer"
          />
          <button
            onClick={() => {
              setShowPicker(false);
              setPemError('');
            }}
            className="text-xs text-gray-400 hover:underline"
          >
            Cancel
          </button>
        </div>
      );
    }

    // State D — default, no wallet loaded
    // If the account already has a linked address → show a distinct "reload" prompt
    if (user?.walletAddress) {
      return (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded px-4 py-3">
            <p className="text-sm font-medium text-amber-800">
              Wallet not loaded this session
            </p>
            <p className="text-xs text-amber-700 mt-1">
              Your wallet <span className="font-mono">{user?.walletAddress?.slice(0, 16)}…</span> is
              linked to this account, but the PEM key is not in memory. You must upload it again
              each session to sign transactions.
            </p>
          </div>
          <button
            onClick={() => setShowPicker(true)}
            className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700"
          >
            Load PEM
          </button>
        </div>
      );
    }

    return (
      <button
        onClick={() => setShowPicker(true)}
        className="bg-green-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-green-700"
      >
        Add Wallet
      </button>
    );
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold mb-6">Profile</h1>

      {/* User info */}
      <div className="bg-white rounded border border-gray-200 p-5 space-y-3 mb-6">
        <div>
          <span className="text-xs text-gray-500 uppercase tracking-wide">Email</span>
          <p className="text-sm mt-0.5">{user.email}</p>
        </div>
        {user.walletAddress && (
          <div>
            <span className="text-xs text-gray-500 uppercase tracking-wide">Linked address</span>
            <p className="text-sm font-mono break-all mt-0.5">{user.walletAddress}</p>
          </div>
        )}
      </div>

      {/* Wallet section */}
      <div className="bg-white rounded border border-gray-200 p-5">
        <h2 className="font-medium mb-1">Wallet</h2>
        <p className="text-xs text-gray-500 mb-4">
          Upload your PEM file to sign on-chain transactions. The key stays in browser memory only
          — it is never sent to the server.
        </p>
        {renderWalletSection()}
      </div>
    </div>
  );
}
