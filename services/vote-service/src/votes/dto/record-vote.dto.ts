import { IsString } from 'class-validator';

// Called by blockchain-bridge after a castVote tx is confirmed on-chain.
export class RecordVoteDto {
  @IsString()
  voterWallet: string;

  @IsString()
  candidateWallet: string;
}
