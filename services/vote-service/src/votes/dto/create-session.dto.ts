import {
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CandidateInputDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  wallet: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class EligibleVoterInputDto {
  @IsString()
  wallet: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class CreateSessionDto {
  @IsUUID()
  associationId: string;

  @IsString()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  deadline: string;

  @IsInt()
  @Min(1)
  quorum: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CandidateInputDto)
  candidates: CandidateInputDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EligibleVoterInputDto)
  eligibleVoters: EligibleVoterInputDto[];
}
