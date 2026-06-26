import { IsIn } from 'class-validator';
import type { ShareAccess } from '../snippet-share.entity';

/**
 * Request body for changing an existing invite's access level (PATCH share).
 * Only the access level is mutable; the invited email / snippet are fixed.
 */
export class UpdateShareDto {
  // Must be one of the two valid levels — rejects typos / arbitrary strings.
  @IsIn(['view', 'edit'])
  access: ShareAccess;
}
