import { IsString } from 'class-validator';

export class SetPaymasterDto {
  @IsString()
  walletAddress: string;

  @IsString()
  pemContent: string;
}
