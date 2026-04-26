'use client';

import {
  Address,
  Transaction,
  TransactionComputer,
  UserSigner,
} from '@multiversx/sdk-core';

export function parsePem(pemContent: string): { signer: UserSigner; address: string } {
  const signer = UserSigner.fromPem(pemContent);
  const address = signer.getAddress().toBech32();
  return { signer, address };
}

// Accepts the plain unsigned tx object returned by the bridge and returns
// a sendable object with the signature field added.
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
    data: Buffer.from(unsignedTxObj.data as string, 'base64'),
    chainID: unsignedTxObj.chainID as string,
    version: unsignedTxObj.version as number,
  });

  const computer = new TransactionComputer();
  const sig = await signer.sign(computer.computeBytesForSigning(tx));
  tx.signature = sig;

  return tx.toSendable() as Record<string, unknown>;
}
