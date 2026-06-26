import { IsEmail, IsIn, IsOptional, MaxLength } from 'class-validator';
import type { ShareAccess } from '../snippet-share.entity';

/**
 * Request body for POST /analyses/:id/shares — invite one email to a snippet.
 */
export class CreateShareDto {
  // Must be a real email (access is granted by email match) and bounded to a
  // normal column length.
  @IsEmail({}, { message: 'A valid email is required' })
  @MaxLength(255)
  email: string;

  // Access level; restricted to the two valid values, defaults to 'view'
  // server-side when omitted.
  @IsOptional()
  @IsIn(['view', 'edit'])
  access?: ShareAccess;
}
