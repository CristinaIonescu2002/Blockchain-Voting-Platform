import { IsString, Matches } from 'class-validator';

export class LinkWalletDto {
  @IsString()
  @Matches(/^erd1[a-z0-9]{58}$/, { message: 'Invalid MultiversX address' })
  walletAddress: string;
}
