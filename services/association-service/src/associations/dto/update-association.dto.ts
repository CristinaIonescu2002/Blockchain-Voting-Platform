import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAssociationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // Set by blockchain-bridge after on-chain registration
  @IsOptional()
  @IsString()
  @MaxLength(64)
  scAssocId?: string;
}
