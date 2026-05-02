import { IsIn, IsNumberString, IsObject, IsOptional, IsString } from 'class-validator';

// Used for admin actions: registerAssociation, registerMember, createVotingSession, stopSession.
// Frontend signs the tx and sends it here; bridge forwards to chain and syncs DB.
export class SubmitSignedTxDto {
  @IsObject()
  signedTx: object;

  // Context for DB sync after confirmation
  @IsOptional()
  @IsString()
  associationId?: string; // DB association UUID (registerAssociation flow)

  @IsOptional()
  @IsString()
  sessionId?: string; // DB session UUID (createVotingSession flow)

  @IsOptional()
  @IsNumberString()
  scAssocId?: string; // on-chain assoc id — needed to look up scSessionId

  /** After stopSession tx: patch vote-service session status to `stopped` (no scSessionId resolution). */
  @IsOptional()
  @IsIn(['stopped'])
  sessionSyncStatus?: 'stopped';
}
