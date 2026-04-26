import { IsNumberString, IsString } from 'class-validator';

export class BuildVoteTxDto {
  @IsNumberString()
  scAssocId: string; // on-chain assoc id (u64 as string)

  @IsNumberString()
  scSessionId: string; // on-chain session id (u64 as string)

  @IsString()
  candidateWallet: string; // bech32 address of the candidate

  @IsString()
  voterWallet: string; // bech32 address of the voter

  @IsNumberString()
  voterNonce: string; // current nonce of voter account
}
