// Application entry point: boots the Nest app, wires global request handling
// (CORS + validation), and starts listening for HTTP traffic.
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 8080;

  // Allow the Next.js frontend (separate origin) to call this API from the browser.
  app.enableCors();
  // One validation pipe for every route, so each DTO's class-validator rules
  // are enforced consistently before any controller method runs.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties not in the DTO
      forbidNonWhitelisted: true, // 400 if unknown properties are sent
      transform: true, // coerce payloads into DTO class instances
    }),
  );
  await app.listen(port);
}

void bootstrap();
