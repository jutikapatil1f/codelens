// Core business logic for analyses. Owns the Analysis/Message/Share tables and
// is the PRODUCER side of the Bull queue: it persists a 'pending' row then
// enqueues an 'analyze' job (consumed by AnalysisProcessor). Also handles access
// (owner vs invited), follow-up chat, and the share allowlist.
import { InjectQueue } from '@nestjs/bull';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bull';
import { In, Repository } from 'typeorm';
import { AiService, type ChatMessage } from './ai.service';
import { Analysis } from './analysis.entity';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { UpdateAnalysisDto } from './dto/update-analysis.dto';
import { Message } from './message.entity';
import { ShareAccess, SnippetShare } from './snippet-share.entity';

export const ANALYSIS_QUEUE = 'analysis';
export const ANALYZE_JOB = 'analyze';
export type AnalysisAccess = 'owner' | ShareAccess;
export type AnalysisWithAccess = Analysis & { access: AnalysisAccess };

@Injectable()
export class AnalysisService {
  constructor(
    @InjectRepository(Analysis)
    private readonly analyses: Repository<Analysis>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(SnippetShare)
    private readonly shares: Repository<SnippetShare>,
    @InjectQueue(ANALYSIS_QUEUE)
    private readonly queue: Queue,
    private readonly ai: AiService,
  ) {}

  // Persist a new snippet as 'pending' and queue it for the background worker.
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

  /**
   * Returns an analysis if the requester may VIEW it — i.e. they own it, or
   * their email has been invited via a snippet share. Throws NotFound (not
   * Forbidden) when neither holds, so we don't leak which ids exist.
   */
  async findViewable(
    userId: string,
    email: string,
    id: string,
  ): Promise<AnalysisWithAccess> {
    const analysis = await this.analyses.findOne({ where: { id } });
    if (!analysis) {
      throw new NotFoundException('Analysis not found');
    }
    if (analysis.userId === userId) {
      return Object.assign(analysis, { access: 'owner' as const });
    }
    const share = await this.shares.findOne({
      where: { analysisId: id, invitedEmail: email.toLowerCase() },
    });
    if (!share) {
      throw new NotFoundException('Analysis not found');
    }
    return Object.assign(analysis, { access: share.access });
  }

  // Boolean form of findViewable, for the WebSocket gateway's room-join check.
  async canView(userId: string, email: string, id: string): Promise<boolean> {
    try {
      await this.findViewable(userId, email, id);
      return true;
    } catch {
      return false;
    }
  }

  async canEdit(userId: string, email: string, id: string): Promise<boolean> {
    try {
      const analysis = await this.findViewable(userId, email, id);
      return analysis.access === 'owner' || analysis.access === 'edit';
    } catch {
      return false;
    }
  }

  // Returns the follow-up conversation for an analysis, oldest first. Readable
  // by the owner or anyone the snippet is shared with.
  async listMessages(
    userId: string,
    email: string,
    analysisId: string,
  ): Promise<Message[]> {
    await this.findViewable(userId, email, analysisId);
    return this.messages.find({
      where: { analysisId },
      order: { createdAt: 'ASC' },
    });
  }

  // ── Sharing (invite-only allowlist) ──────────────────────────────────────

  // Snippets shared WITH this user (by their email). Newest first.
  async findSharedWithUser(email: string): Promise<AnalysisWithAccess[]> {
    const shares = await this.shares.find({
      where: { invitedEmail: email.toLowerCase() },
    });
    const ids = shares.map((s) => s.analysisId);
    if (ids.length === 0) return [];
    const analyses = await this.analyses.find({
      where: { id: In(ids) },
      order: { createdAt: 'DESC' },
    });
    const accessById = new Map(shares.map((s) => [s.analysisId, s.access]));
    return analyses.map((a) =>
      Object.assign(a, { access: accessById.get(a.id) ?? 'view' }),
    );
  }

  // Owner-only: the invite list for a snippet.
  async listShares(
    ownerId: string,
    analysisId: string,
  ): Promise<SnippetShare[]> {
    await this.findOneForUser(ownerId, analysisId);
    return this.shares.find({
      where: { analysisId },
      order: { createdAt: 'ASC' },
    });
  }

  // Owner-only: invite an email. Idempotent — re-inviting returns the existing
  // share. You can't invite yourself (you already own it).
  async addShare(
    owner: { id: string; email: string },
    analysisId: string,
    email: string,
    access: ShareAccess = 'view',
  ): Promise<SnippetShare> {
    await this.findOneForUser(owner.id, analysisId);
    const invitedEmail = email.trim().toLowerCase();
    if (invitedEmail === owner.email.toLowerCase()) {
      throw new BadRequestException('You already own this snippet');
    }
    const existing = await this.shares.findOne({
      where: { analysisId, invitedEmail },
    });
    if (existing) {
      existing.access = access;
      return this.shares.save(existing);
    }
    return this.shares.save(
      this.shares.create({
        analysisId,
        invitedEmail,
        access,
        invitedBy: owner.id,
      }),
    );
  }

  // Owner-only: switch an existing invite between view and edit access.
  async updateShareAccess(
    ownerId: string,
    analysisId: string,
    shareId: string,
    access: ShareAccess,
  ): Promise<SnippetShare> {
    await this.findOneForUser(ownerId, analysisId);
    const share = await this.shares.findOne({
      where: { id: shareId, analysisId },
    });
    if (!share) {
      throw new NotFoundException('Share not found');
    }
    share.access = access;
    return this.shares.save(share);
  }

  // Owner-only: revoke an invite.
  async removeShare(
    ownerId: string,
    analysisId: string,
    shareId: string,
  ): Promise<void> {
    await this.findOneForUser(ownerId, analysisId);
    await this.shares.delete({ id: shareId, analysisId });
  }

  async updateContent(
    userId: string,
    email: string,
    analysisId: string,
    dto: UpdateAnalysisDto,
  ): Promise<Analysis> {
    const analysis = await this.findViewable(userId, email, analysisId);
    if (analysis.access !== 'owner' && analysis.access !== 'edit') {
      throw new NotFoundException('Analysis not found');
    }

    // No-op if nothing actually changed, so we don't needlessly invalidate
    // a good result.
    const nextCode = dto.code ?? analysis.code;
    const nextLanguage = dto.language ?? analysis.language;
    if (nextCode === analysis.code && nextLanguage === analysis.language) {
      return analysis;
    }

    // Code changed → the old review no longer matches. Mark 'stale' and drop
    // the result/error; reanalyze must be called to refresh it.
    analysis.code = nextCode;
    analysis.language = nextLanguage;
    analysis.status = 'stale';
    analysis.result = null;
    analysis.error = null;
    return this.analyses.save(analysis);
  }

  async reanalyze(
    userId: string,
    email: string,
    analysisId: string,
  ): Promise<Analysis> {
    const analysis = await this.findViewable(userId, email, analysisId);
    if (analysis.access !== 'owner' && analysis.access !== 'edit') {
      throw new NotFoundException('Analysis not found');
    }
    if (!analysis.code.trim()) {
      throw new BadRequestException('Code is required');
    }
    // Reset to 'pending' and re-enqueue; the worker will overwrite result.
    analysis.status = 'pending';
    analysis.result = null;
    analysis.error = null;
    const saved = await this.analyses.save(analysis);
    await this.queue.add(ANALYZE_JOB, { analysisId: saved.id });
    return saved;
  }

  /**
   * Records a follow-up question, asks the model (with the original code +
   * analysis + prior turns as context), persists the reply, and returns both
   * new turns. Runs synchronously — the HTTP request waits for the model.
   */
  async addMessage(
    userId: string,
    email: string,
    analysisId: string,
    content: string,
  ): Promise<{ question: Message; answer: Message }> {
    // Edit access check + load the seed of the conversation.
    const analysis = await this.findViewable(userId, email, analysisId);
    if (analysis.access !== 'owner' && analysis.access !== 'edit') {
      throw new NotFoundException('Analysis not found');
    }
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
