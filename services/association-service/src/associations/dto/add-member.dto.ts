import { IsEmail, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class AddMemberDto {
  // Either userEmail (preferred from UI) or userId (UUID) must be provided
  @IsOptional()
  @IsEmail()
  userEmail?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^erd1[a-z0-9]{58}$/, { message: 'Invalid MultiversX address' })
  walletAddress?: string;
}
