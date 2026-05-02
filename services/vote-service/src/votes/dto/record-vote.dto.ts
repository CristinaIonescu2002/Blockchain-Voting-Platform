import { IsArray, IsOptional, IsString } from 'class-validator';

// Called by blockchain-bridge after a castVote tx is confirmed on-chain.
export class RecordVoteDto {
  @IsString()
  voterWallet: string;

  @IsOptional()
  @IsString()
  candidateWallet?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  candidateWallets?: string[];
}
