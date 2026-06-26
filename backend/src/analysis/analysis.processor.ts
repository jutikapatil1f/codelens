// Bull queue consumer: picks up enqueued 'analyze' jobs and runs the slow AI
// review off the HTTP path, writing status/result back to the analyses table.
import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bull';
import { Repository } from 'typeorm';
import { AiService } from './ai.service';
import { Analysis } from './analysis.entity';
import { ANALYSIS_QUEUE, ANALYZE_JOB } from './analysis.service';

// Shape of the payload AnalysisService puts on the queue. We store only the
// row id, not the whole record — the worker re-loads fresh data from the DB.
interface AnalyzeJobData {
  analysisId: string;
}

/**
 * Background worker for code analysis.
 *
 * This is the CONSUMER side of the Bull queue. AnalysisService is the producer:
 * when POST /analyses runs, it saves a 'pending' row and enqueues an 'analyze'
 * job, then returns immediately. Bull (backed by Redis) later hands that job to
 * the method below, which does the slow AI work off the HTTP request path.
 *
 * It drives the status state machine: pending -> processing -> completed | failed.
 */
@Processor(ANALYSIS_QUEUE)
export class AnalysisProcessor {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    // Same Analysis table the service writes to — here we read the job's row
    // and write its result/status back.
    @InjectRepository(Analysis)
    private readonly analyses: Repository<Analysis>,
    // Wraps the Ollama call that actually analyzes the code.
    private readonly ai: AiService,
  ) {}

  // Handles jobs named ANALYZE_JOB ('analyze') from the analysis queue.
  // Bull calls this automatically for each queued job; the return value isn't
  // sent anywhere — results are persisted to the DB instead.
  @Process(ANALYZE_JOB)
  async handleAnalyze(job: Job<AnalyzeJobData>): Promise<void> {
    // 1. The job carries only the id; load the current row from Neon.
    const { analysisId } = job.data;
    const analysis = await this.analyses.findOne({ where: { id: analysisId } });
    if (!analysis) {
      // Row was deleted between enqueue and processing — nothing to do.
      this.logger.warn(`Analysis ${analysisId} no longer exists; skipping`);
      return;
    }

    // 2. Mark in-progress so a polling client can see it moved past 'pending'.
    await this.analyses.update(analysisId, { status: 'processing' });

    try {
      // 3. The slow part: call the AI model. Can take tens of seconds on CPU.
      const result = await this.ai.analyzeCode(
        analysis.code,
        analysis.language,
      );
      // 4. Success — store the output and clear any previous error.
      await this.analyses.update(analysisId, {
        status: 'completed',
        result,
        error: null,
      });
      this.logger.log(`Analysis ${analysisId} completed`);
    } catch (err) {
      // 5. Failure — record the reason on the row so the client can see why.
      const message = err instanceof Error ? err.message : String(err);
      await this.analyses.update(analysisId, {
        status: 'failed',
        error: message,
      });
      this.logger.error(`Analysis ${analysisId} failed: ${message}`);
      // Re-throw so Bull marks the job failed and can apply its retry policy.
      // (Without this, Bull would consider the job successfully handled.)
      throw err;
    }
  }
}
