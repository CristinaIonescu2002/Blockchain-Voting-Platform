import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateSessionDto {
  @IsOptional()
  @IsIn(['draft', 'open', 'stopped', 'finalized'])
  status?: 'draft' | 'open' | 'stopped' | 'finalized';

  // Set by blockchain-bridge after SC call
  @IsOptional()
  @IsString()
  scSessionId?: string;
}
