import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { Analysis } from './analysis.entity';
import { AnalysisController } from './analysis.controller';
import { AnalysisProcessor } from './analysis.processor';
import { AnalysisService, ANALYSIS_QUEUE } from './analysis.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Analysis]),
    BullModule.registerQueue({ name: ANALYSIS_QUEUE }),
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService, AnalysisProcessor, AiService],
})
export class AnalysisModule {}
