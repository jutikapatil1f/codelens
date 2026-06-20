import { InjectQueue } from '@nestjs/bull';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bull';
import { Repository } from 'typeorm';
import { Analysis } from './analysis.entity';
import { CreateAnalysisDto } from './dto/create-analysis.dto';

export const ANALYSIS_QUEUE = 'analysis';
export const ANALYZE_JOB = 'analyze';

@Injectable()
export class AnalysisService {
  constructor(
    @InjectRepository(Analysis)
    private readonly analyses: Repository<Analysis>,
    @InjectQueue(ANALYSIS_QUEUE)
    private readonly queue: Queue,
  ) {}

  async create(userId: string, dto: CreateAnalysisDto): Promise<Analysis> {
    const analysis = this.analyses.create({
      userId,
      code: dto.code,
      language: dto.language ?? 'plaintext',
      status: 'pending',
    });
    const saved = await this.analyses.save(analysis);

    // Hand off to the background worker; the request returns immediately.
    await this.queue.add(ANALYZE_JOB, { analysisId: saved.id });
    return saved;
  }

  findAllForUser(userId: string): Promise<Analysis[]> {
    return this.analyses.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOneForUser(userId: string, id: string): Promise<Analysis> {
    const analysis = await this.analyses.findOne({ where: { id, userId } });
    if (!analysis) {
      throw new NotFoundException('Analysis not found');
    }
    return analysis;
  }
}
