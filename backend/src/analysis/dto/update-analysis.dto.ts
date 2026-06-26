import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for editing a snippet's source/language (used by both the REST PATCH
 * and the presence gateway's save path). Every field is optional so a caller
 * can update just the code or just the language; whitelist strips the rest.
 */
export class UpdateAnalysisDto {
  // Same 1..50k bound as create — caps the payload sent on to the AI model.
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50000, { message: 'Code must be 50,000 characters or fewer' })
  code?: string;

  // Optional language hint; bounded to keep it a short identifier.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;
}
