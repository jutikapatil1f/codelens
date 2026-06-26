// Wires up the analysis feature: entities (TypeORM), the Bull queue, JWT for the
// presence socket, and the controller/service/processor/gateway providers.
import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { Analysis } from './analysis.entity';
import { AnalysisController } from './analysis.controller';
import { AnalysisProcessor } from './analysis.processor';
import { AnalysisService, ANALYSIS_QUEUE } from './analysis.service';
import { Message } from './message.entity';
import { PresenceGateway } from './presence.gateway';
import { SnippetShare } from './snippet-share.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Analysis, Message, SnippetShare]),
    BullModule.registerQueue({ name: ANALYSIS_QUEUE }),
    // The gateway verifies socket JWTs with the same secret as HTTP auth.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService, AnalysisProcessor, AiService, PresenceGateway],
})
export class AnalysisModule {}
