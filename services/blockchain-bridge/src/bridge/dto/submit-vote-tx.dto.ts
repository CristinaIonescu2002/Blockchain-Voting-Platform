import { IsObject, IsString } from 'class-validator';

export class SubmitVoteTxDto {
  @IsString()
  sessionId: string; // DB session UUID (to record vote after confirmation)

  @IsObject()
  signedInnerTx: object; // signed tx JSON from frontend
}
