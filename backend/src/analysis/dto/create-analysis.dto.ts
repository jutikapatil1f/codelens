import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Request body for POST /analyses.
 * Note what is intentionally absent: status, result, and userId are set
 * server-side, never accepted from the client. The global ValidationPipe
 * also strips any extra fields not declared here (whitelist: true).
 */
export class CreateAnalysisDto {
  // The source code to analyze. Required, non-empty, and capped at 50k
  // characters to bound the payload sent to the AI model.
  @IsString()
  @MinLength(1)
  @MaxLength(50000, { message: 'Code must be 50,000 characters or fewer' })
  code: string;

  // Optional language hint (e.g. "javascript") used to guide the AI prompt.
  // Defaults to "plaintext" in the service when omitted.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;
}
