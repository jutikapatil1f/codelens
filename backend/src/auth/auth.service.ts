// Core auth logic: hashes/verifies passwords and mints signed JWTs.
// Both the controller and JwtStrategy lean on this for credentials handling.
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';

// Claims embedded in every token. `sub` (subject) is the user id, per JWT convention.
export interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: AuthCredentialsDto) {
    // Hash with bcrypt (cost 10) so the plaintext password is never stored;
    // registration logs the new user straight in by returning a token.
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.users.create(dto.email, passwordHash);
    return this.signToken(user.id, user.email);
  }

  async login(dto: AuthCredentialsDto) {
    // Needs the hash explicitly (it's select:false on the entity) to compare.
    const user = await this.users.findByEmailWithPassword(dto.email);
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      // Same error for both cases so we don't leak which emails exist.
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.signToken(user.id, user.email);
  }

  private async signToken(userId: string, email: string) {
    const payload: JwtPayload = { sub: userId, email };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken };
  }
}
