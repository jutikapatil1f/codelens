// Root module: wires global config, the Postgres connection, the Redis-backed
// job queue (Bull), and the feature modules (auth + analysis) into one app.
import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisModule } from './analysis/analysis.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // Load .env once and make ConfigService injectable everywhere.
    ConfigModule.forRoot({ isGlobal: true }),
    // Async so the connection URL is read from config at startup, not hardcoded.
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.getOrThrow<string>('DATABASE_URL');
        return {
          type: 'postgres',
          url,
          autoLoadEntities: true,
          // Auto-create the schema in dev only; production must run migrations.
          // Set NODE_ENV=production to disable destructive auto-sync.
          synchronize: config.get<string>('NODE_ENV') !== 'production',
          // Enable SSL only when the connection string requests it (e.g. Neon).
          // The bundled/local Postgres doesn't support SSL, so default to off.
          ssl: /sslmode=require|ssl=true/.test(url)
            ? { rejectUnauthorized: false }
            : false,
        };
      },
    }),
    // Shared queue backend for the slow AI analysis jobs (offloaded from the
    // HTTP request path to a background worker via Redis).
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Bull wants host/port separately, so split the redis:// URL apart.
        const url = new URL(
          config.get<string>('REDIS_URL', 'redis://localhost:6379'),
        );
        return {
          redis: {
            host: url.hostname,
            port: Number(url.port) || 6379,
            // Managed Redis (e.g. Railway) requires auth — carry the
            // username/password through instead of dropping them.
            username: url.username || undefined,
            password: url.password || undefined,
            // Railway's internal host resolves over IPv6; family: 0 lets
            // ioredis try both stacks. rediss:// URLs also need TLS enabled.
            family: 0,
            ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
          },
        };
      },
    }),
    AuthModule,
    AnalysisModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
