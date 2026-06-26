// HTTP surface for authentication: register, login, and the current-user
// lookup. Delegates all logic to AuthService; this layer is just routing.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: AuthCredentialsDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  // Override Nest's default 201-for-POST: a login isn't a resource creation.
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: AuthCredentialsDto) {
    return this.auth.login(dto);
  }

  // Guard requires a valid JWT; the user it resolves is what we echo back,
  // letting the frontend verify a token and fetch the logged-in identity.
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Request() req: { user: { id: string; email: string } }) {
    return req.user;
  }
}
