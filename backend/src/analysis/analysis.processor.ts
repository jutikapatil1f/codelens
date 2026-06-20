import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bull';
import { Repository } from 'typeorm';
import { AiService } from './ai.service';
import { Analysis } from './analysis.entity';
import { ANALYSIS_QUEUE, ANALYZE_JOB } from './analysis.service';

interface AnalyzeJobData {
  analysisId: string;
}

@Processor(ANALYSIS_QUEUE)
export class AnalysisProcessor {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    @InjectRepository(Analysis)
    private readonly analyses: Repository<Analysis>,
    private readonly ai: AiService,
  ) {}

  @Process(ANALYZE_JOB)
  async handleAnalyze(job: Job<AnalyzeJobData>): Promise<void> {
    const { analysisId } = job.data;
    const analysis = await this.analyses.findOne({ where: { id: analysisId } });
    if (!analysis) {
      this.logger.warn(`Analysis ${analysisId} no longer exists; skipping`);
      return;
    }

    await this.analyses.update(analysisId, { status: 'processing' });

    try {
      const result = await this.ai.analyzeCode(analysis.code, analysis.language);
      await this.analyses.update(analysisId, {
        status: 'completed',
        result,
        error: null,
      });
      this.logger.log(`Analysis ${analysisId} completed`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.analyses.update(analysisId, { status: 'failed', error: message });
      this.logger.error(`Analysis ${analysisId} failed: ${message}`);
      throw err; // let Bull record the failure / apply retry policy
    }
  }
}
