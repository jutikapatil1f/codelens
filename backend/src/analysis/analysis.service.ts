import { InjectQueue } from '@nestjs/bull';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bull';
import { Repository } from 'typeorm';
import { AiService, type ChatMessage } from './ai.service';
import { Analysis } from './analysis.entity';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { Message } from './message.entity';

export const ANALYSIS_QUEUE = 'analysis';
export const ANALYZE_JOB = 'analyze';

@Injectable()
export class AnalysisService {
  constructor(
    @InjectRepository(Analysis)
    private readonly analyses: Repository<Analysis>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectQueue(ANALYSIS_QUEUE)
    private readonly queue: Queue,
    private readonly ai: AiService,
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

  // Returns the follow-up conversation for an analysis, oldest first. Throws
  // if the analysis doesn't belong to the user (findOneForUser enforces this).
  async listMessages(userId: string, analysisId: string): Promise<Message[]> {
    await this.findOneForUser(userId, analysisId);
    return this.messages.find({
      where: { analysisId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Records a follow-up question, asks the model (with the original code +
   * analysis + prior turns as context), persists the reply, and returns both
   * new turns. Runs synchronously — the HTTP request waits for the model.
   */
  async addMessage(
    userId: string,
    analysisId: string,
    content: string,
  ): Promise<{ question: Message; answer: Message }> {
    // Ownership check + load the seed of the conversation.
    const analysis = await this.findOneForUser(userId, analysisId);
    if (analysis.status !== 'completed') {
      throw new BadRequestException(
        'Wait for the analysis to finish before asking follow-up questions',
      );
    }

    // Persist the user's question before the slow model call so it isn't lost
    // if the request is interrupted.
    const question = await this.messages.save(
      this.messages.create({ analysisId, role: 'user', content }),
    );

    // Build the chat context: system seed + every prior turn (now including
    // the question we just saved).
    const prior = await this.messages.find({
      where: { analysisId },
      order: { createdAt: 'ASC' },
    });
    const chat: ChatMessage[] = [
      { role: 'system', content: this.buildSystemContext(analysis) },
      ...prior.map((m) => ({ role: m.role, content: m.content })),
    ];

    const reply = await this.ai.chat(chat);

    const answer = await this.messages.save(
      this.messages.create({ analysisId, role: 'assistant', content: reply }),
    );
    return { question, answer };
  }

  // The system message that grounds the follow-up conversation in the code the
  // user submitted and the review the model already produced.
  private buildSystemContext(analysis: Analysis): string {
    return [
      `You are a senior code reviewer answering follow-up questions about ${analysis.language} code you already reviewed.`,
      'Be concise, specific, and practical. Reference line numbers where useful.',
      '',
      'STRICT SCOPE: Only answer questions about THIS code snippet and your review',
      'of it (bugs, fixes, complexity, refactors, language/runtime behaviour as it',
      'relates to this code). If the question is off-topic — general knowledge,',
      'current events, trivia, people, or anything not about this code — do NOT',
      'answer it. Instead reply with exactly this sentence and nothing else:',
      `"I can only answer questions about this code snippet."`,
      '',
      'The code under review:',
      '```' + analysis.language,
      analysis.code,
      '```',
      '',
      'Your earlier analysis (JSON):',
      analysis.result ?? '(none)',
    ].join('\n');
  }
}
