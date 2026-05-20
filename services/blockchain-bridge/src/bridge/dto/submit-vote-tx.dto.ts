import { IsArray, IsObject, IsString } from 'class-validator';

export class SubmitVoteTxDto {
  @IsString()
  sessionId: string; // DB session UUID (to record vote after confirmation)

  @IsObject()
  signedInnerTx: object; // signed tx JSON from frontend
}

export class SubmitSignedVoteIntentDto {
  @IsString()
  associationId: string;

  @IsString()
  sessionId: string;

  @IsString()
  scAssocId: string;

  @IsString()
  scSessionId: string;

  @IsString()
  voterWallet: string;

  @IsArray()
  @IsString({ each: true })
  candidateWallets: string[];

  @IsString()
  signature: string;

  @IsString()
  message: string;
}
