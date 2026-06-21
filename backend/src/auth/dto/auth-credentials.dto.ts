import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * Request body for POST /auth/register and POST /auth/login.
 * The global ValidationPipe validates these rules and rejects bad
 * requests with a 400 before the controller runs.
 */
export class AuthCredentialsDto {
  // Must be a syntactically valid email address.
  @IsEmail()
  email: string;

  // Plaintext password from the client; hashed before it ever hits the DB.
  // Minimum 8 characters to enforce a basic strength floor.
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;
}
