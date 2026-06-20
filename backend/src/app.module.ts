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
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: true, // dev only — switch to migrations before production
        ssl: { rejectUnauthorized: false }, // required by Neon
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(
          config.get<string>('REDIS_URL', 'redis://localhost:6379'),
        );
        return {
          redis: {
            host: url.hostname,
            port: Number(url.port) || 6379,
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
