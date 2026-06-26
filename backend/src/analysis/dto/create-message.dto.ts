import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Request body for POST /analyses/:id/messages — a single follow-up question.
 * The role is always 'user' server-side; only the question text is accepted.
 */
export class CreateMessageDto {
  // Required non-empty text, capped at 4k chars to bound what we forward to the
  // chat model as a single turn.
  @IsString()
  @MinLength(1)
  @MaxLength(4000, { message: 'Question must be 4,000 characters or fewer' })
  content: string;
}
