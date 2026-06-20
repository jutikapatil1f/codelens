import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalysisService } from './analysis.service';
import { CreateAnalysisDto } from './dto/create-analysis.dto';

@Controller('analyses')
@UseGuards(JwtAuthGuard)
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAnalysisDto) {
    return this.analysis.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.analysis.findAllForUser(user.id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.analysis.findOneForUser(user.id, id);
  }
}
