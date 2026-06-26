// HTTP surface for analyses: CRUD on snippets, follow-up messages, and sharing.
// Endpoints only validate auth/params and delegate to AnalysisService; the slow
// AI work is enqueued there and run by the background processor.
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalysisService } from './analysis.service';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { CreateShareDto } from './dto/create-share.dto';
import { UpdateAnalysisDto } from './dto/update-analysis.dto';
import { UpdateShareDto } from './dto/update-share.dto';

@Controller('analyses')
@UseGuards(JwtAuthGuard)
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  // Submit a snippet: saves it 'pending' and enqueues the analysis job, then
  // returns right away. The client polls findOne for the result.
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAnalysisDto) {
    return this.analysis.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.analysis.findAllForUser(user.id);
  }

  // Snippets shared WITH the current user. Declared before ':id' so the
  // literal path isn't swallowed by the id param.
  @Get('shared')
  findShared(@CurrentUser() user: AuthUser) {
    return this.analysis.findSharedWithUser(user.email);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.analysis.findViewable(user.id, user.email, id);
  }

  // Edit the snippet's code/language (owner or 'edit' invitee). Changing it
  // marks the analysis 'stale' until reanalyze is called.
  @Patch(':id')
  updateContent(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnalysisDto,
  ) {
    return this.analysis.updateContent(user.id, user.email, id, dto);
  }

  // Re-queue an existing snippet (e.g. after an edit): resets it to 'pending'
  // and enqueues a fresh analyze job.
  @Post(':id/analyze')
  reanalyze(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.analysis.reanalyze(user.id, user.email, id);
  }

  // The follow-up conversation attached to an analysis (owner or invited).
  @Get(':id/messages')
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.analysis.listMessages(user.id, user.email, id);
  }

  // Ask a follow-up question (owner only). Waits for the model and returns the
  // new { question, answer } pair.
  @Post(':id/messages')
  addMessage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.analysis.addMessage(user.id, user.email, id, dto.content);
  }

  // ── Sharing (owner-only management) ──────────────────────────────────────
  // These three manage a snippet's invite allowlist. Each verifies the caller
  // OWNS the snippet (in the service, via findOneForUser) before doing anything,
  // so only the owner can see or change who has access.

  // List everyone the snippet is shared with (the invite allowlist).
  @Get(':id/shares')
  listShares(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.analysis.listShares(user.id, id);
  }

  // Invite one email to view the snippet. Idempotent — re-inviting the same
  // address returns the existing share. The full `user` is passed (not just id)
  // so the service can reject inviting yourself. No email is sent; this is a
  // pure allowlist (the invitee gains access when they log in with that email).
  @Post(':id/shares')
  addShare(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateShareDto,
  ) {
    return this.analysis.addShare(user, id, dto.email, dto.access);
  }

  @Patch(':id/shares/:shareId')
  updateShare(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shareId', ParseUUIDPipe) shareId: string,
    @Body() dto: UpdateShareDto,
  ) {
    return this.analysis.updateShareAccess(user.id, id, shareId, dto.access);
  }

  // Revoke an invite by its share id, immediately removing that person's access.
  @Delete(':id/shares/:shareId')
  removeShare(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shareId', ParseUUIDPipe) shareId: string,
  ) {
    return this.analysis.removeShare(user.id, id, shareId);
  }
}
