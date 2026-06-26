// Route guard that triggers the 'jwt' Passport strategy. Apply with
// @UseGuards(JwtAuthGuard) to require a valid bearer token; rejects with 401 otherwise.
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Thin named subclass so routes reference JwtAuthGuard instead of the raw string.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
