import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAssociationDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
