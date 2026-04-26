import { IsObject, IsOptional, IsString } from 'class-validator';

// Used for admin actions: registerAssociation, registerMember, createVotingSession, stopSession.
// Frontend signs the tx and sends it here; bridge forwards to chain and syncs DB.
export class SubmitSignedTxDto {
  @IsObject()
  signedTx: object;

  // Context for DB sync after confirmation
  @IsOptional()
  @IsString()
  associationId?: string; // DB association UUID

  @IsOptional()
  @IsString()
  sessionId?: string; // DB session UUID
}
