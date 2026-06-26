// Passport 'jwt' strategy: extracts and verifies the bearer token on guarded
// routes, then resolves it to a live user that gets attached to request.user.
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
  ) {
    super({
      // Read the token from the `Authorization: Bearer <token>` header.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false, // reject tokens past their 1d expiry
      // Same secret the tokens were signed with; must match AuthModule's config.
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Runs only after the signature/expiry already passed. Return value is
  // attached to request.user. We re-fetch by id so deleted users can't keep
  // authenticating on an otherwise-valid token.
  async validate(payload: JwtPayload) {
    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    return { id: user.id, email: user.email };
  }
}
