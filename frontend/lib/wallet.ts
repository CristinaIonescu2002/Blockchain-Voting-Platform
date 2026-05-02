'use client';

import {
  Address,
  Transaction,
  TransactionComputer,
  UserSecretKey,
  UserSigner,
} from '@multiversx/sdk-core';

// ─── PEM parsing ────────────────────────────────────────────────────────────
// Evităm UserSigner.fromPem care importă fs la top-level (nu merge în browser).
// Formatul PEM MultiversX:
//   -----BEGIN PRIVATE KEY for erd1xxxxx-----
//   <base64( hexString(seed_32_bytes || pubkey_32_bytes) )>
//   -----END PRIVATE KEY for erd1xxxxx-----

function extractAddressFromPemHeader(pemContent: string): string {
  const match = pemContent.match(/-----BEGIN PRIVATE KEY for (erd1[a-z0-9]+)-----/);
  if (!match) throw new Error('PEM invalid: nu s-a găsit adresa în header.');
  return match[1];
}

function extractSecretKeyFromPem(pemContent: string): UserSecretKey {
  const lines = pemContent.trim().replace(/\r/g, '').split('\n');
  const base64Content = lines
    .filter((l) => !l.startsWith('-----'))
    .join('')
    .trim();

  // MultiversX PEM payload is base64( hexString(seed || pubkey) ).
  // Two-stage decode — identical to the official SDK's pem.parse():
  //   Stage 1: base64 → hex string (ASCII, e.g. "4a2b…")
  //   Stage 2: hex string → actual key bytes (Uint8Array of 64 bytes)
  const hexString = atob(base64Content);
  const keyBytes = Uint8Array.from(
    (hexString.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)),
  );

  // First 32 bytes = private key seed; last 32 = public key (not needed here).
  return new UserSecretKey(keyBytes.slice(0, 32));
}

export function parsePem(pemContent: string): { signer: UserSigner; address: string } {
  const address = extractAddressFromPemHeader(pemContent);
  const secretKey = extractSecretKeyFromPem(pemContent);
  const signer = new UserSigner(secretKey);
  return { signer, address };
}

// ─── Semnare tranzacție ──────────────────────────────────────────────────────
// Primește obiectul tx nesemnat returnat de bridge și returnează tx semnat.
export async function signTx(
  pemContent: string,
  unsignedTxObj: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { signer } = parsePem(pemContent);

  const tx = new Transaction({
    nonce: BigInt(unsignedTxObj.nonce as number),
    value: BigInt(0),
    receiver: Address.newFromBech32(unsignedTxObj.receiver as string),
    sender: Address.newFromBech32(unsignedTxObj.sender as string),
    gasPrice: BigInt(unsignedTxObj.gasPrice as number),
    gasLimit: BigInt(unsignedTxObj.gasLimit as number),
    data: Buffer.from((unsignedTxObj.data as string) ?? '', 'base64'),
    chainID: unsignedTxObj.chainID as string,
    version: unsignedTxObj.version as number,
    relayer: unsignedTxObj.relayer
      ? Address.newFromBech32(unsignedTxObj.relayer as string)
      : undefined,
  });

  const computer = new TransactionComputer();
  const sig = await signer.sign(computer.computeBytesForSigning(tx));
  tx.signature = sig;

  const sendable = tx.toSendable() as Record<string, unknown>;

  // ed25519 signatures are always 64 bytes = 128 hex chars.
  // Some SDK versions serialise the Uint8Array without per-byte zero-padding
  // (e.g. byte 0x02 becomes "2" not "02"), producing a short hex string that
  // devnet rejects.  Re-derive the hex directly from the raw bytes so every
  // byte is correctly zero-padded to 2 chars.
  sendable.signature = Buffer.from(sig).toString('hex');

  return sendable;
}
