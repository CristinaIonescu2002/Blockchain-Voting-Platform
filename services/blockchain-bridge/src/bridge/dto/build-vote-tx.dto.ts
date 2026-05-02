import { IsArray, IsNumberString, IsOptional, IsString } from 'class-validator';

export class BuildVoteTxDto {
  @IsNumberString()
  scAssocId: string; // on-chain assoc id (u64 as string)

  @IsNumberString()
  scSessionId: string; // on-chain session id (u64 as string)

  @IsOptional()
  @IsString()
  candidateWallet?: string; // bech32 address of the candidate, legacy single-choice param

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  candidateWallets?: string[]; // bech32 addresses of selected candidates

  @IsString()
  voterWallet: string; // bech32 address of the voter
  // voterNonce is NOT passed — bridge fetches it from chain
}
