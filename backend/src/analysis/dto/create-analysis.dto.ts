import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAnalysisDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50000, { message: 'Code must be 50,000 characters or fewer' })
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;
}
