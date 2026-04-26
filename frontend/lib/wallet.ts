'use client';

import {
  Address,
  Transaction,
  TransactionComputer,
  UserSecretKey,
  UserSigner,
} from '@multiversx/sdk-core';

// ─── PEM parsing ────────────────────────────────────────────────────────────
// Evităm UserSigner.fromPem care importă fs la top-level.
// Formatul PEM MultiversX:
//   -----BEGIN PRIVATE KEY for erd1xxxxx-----
//   <base64 de 32 bytes = cheia privată>
//   -----END PRIVATE KEY for erd1xxxxx-----

function extractAddressFromPemHeader(pemContent: string): string {
  const match = pemContent.match(/-----BEGIN PRIVATE KEY for (erd1[a-z0-9]+)-----/);
  if (!match) throw new Error('PEM invalid: nu s-a găsit adresa în header.');
  return match[1];
}

function extractSecretKeyFromPem(pemContent: string): UserSecretKey {
  const lines = pemContent.trim().split('\n');
  const base64 = lines
    .filter((l) => !l.startsWith('-----'))
    .join('')
    .trim();
  const keyBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  // Primii 32 bytes = cheia privată (seed)
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
  });

  const computer = new TransactionComputer();
  const sig = await signer.sign(computer.computeBytesForSigning(tx));
  tx.signature = sig;

  return tx.toSendable() as Record<string, unknown>;
}
