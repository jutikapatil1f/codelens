// Exposes lightweight, unauthenticated health-check endpoints used by
// uptime monitors / deploy platforms to confirm the service is alive.
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Liveness: the process is up and serving HTTP.
  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  // Readiness: also confirms the database is reachable.
  @Get('health/db')
  getDbHealth() {
    return this.appService.getDbHealth();
  }
}
