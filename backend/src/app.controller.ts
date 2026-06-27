// Exposes lightweight, unauthenticated health-check endpoints used by
// uptime monitors / deploy platforms to confirm the service is alive.
import { Controller, Get } from '@nestjs/common';
import { AiService } from './analysis/ai.service';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly aiService: AiService,
  ) {}

  // Public client config: the active AI provider + model, so the UI footer can
  // reflect what's actually running rather than a hardcoded label.
  @Get('config')
  getConfig() {
    return this.aiService.describeModel();
  }

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
