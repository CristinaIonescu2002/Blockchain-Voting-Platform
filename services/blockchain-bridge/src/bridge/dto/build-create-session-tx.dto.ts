import { IsArray, IsNumberString, IsString } from 'class-validator';

export class BuildCreateSessionTxDto {
  @IsNumberString()
  scAssocId: string; // on-chain assoc id (u64)

  @IsString()
  title: string;

  @IsNumberString()
  deadlineTimestamp: string; // unix timestamp in seconds

  @IsNumberString()
  quorum: string;

  @IsArray()
  @IsString({ each: true })
  candidateWallets: string[]; // bech32 addresses of candidates

  @IsArray()
  @IsString({ each: true })
  eligibleVoterWallets: string[]; // bech32 addresses of eligible voters

  @IsString()
  senderAddress: string; // admin wallet (bech32) — signs the tx
}
