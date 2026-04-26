import { IsUUID, IsOptional, IsString, Matches } from 'class-validator';

export class AddMemberDto {
  @IsUUID()
  userId: string;

  @IsOptional()
  @IsString()
  @Matches(/^erd1[a-z0-9]{58}$/, { message: 'Invalid MultiversX address' })
  walletAddress?: string;
}
