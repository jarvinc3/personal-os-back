import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Timeout } from '../../../../core/decorators';
import { PaginationQueryDto } from '../../../../core/pagination/pagination.dto';
import { CreateAiSessionDto } from './dto/create-ai-session.dto';
import { AiSessionsService } from '../application/ai-sessions.service';

@ApiTags('ai-agent')
@ApiBearerAuth('access-token')
@Controller('ai/sessions')
@Timeout(30_000)
export class AiSessionsController {
  constructor(private readonly aiSessionsService: AiSessionsService) {}

  @Get()
  @ApiOperation({ summary: 'List AI chat sessions for current user' })
  list(@CurrentUser('sub') userId: string, @Query() query: PaginationQueryDto) {
    return this.aiSessionsService.list(userId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new AI chat session' })
  create(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateAiSessionDto,
  ) {
    return this.aiSessionsService.create(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get AI session with messages' })
  getById(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.aiSessionsService.getById(id, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete AI session' })
  delete(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.aiSessionsService.delete(id, userId);
  }
}
