import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Env } from '@personal-os/config';
import { CurrentUser } from '@personal-os/core';
import { EmailProductProposalsService } from './email-product-proposals.service';
import {
  ApproveEmailProductProposalDto,
  DiscoverEmailProductProposalsResponseDto,
  DiscoverEmailProductProposalsDto,
  EmailProductProposalResponseDto,
  ListEmailProductProposalsDto,
  UpdateEmailProductProposalDto,
} from './dto/email-product-proposal.dto';

@ApiTags('intelligence')
@ApiBearerAuth('access-token')
@Controller('intelligence/email/product-proposals')
export class EmailProductProposalsController {
  constructor(
    private readonly proposals: EmailProductProposalsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('discover')
  @ApiCreatedResponse({
    description: 'Propuestas detectadas en correos persistidos.',
    type: DiscoverEmailProductProposalsResponseDto,
  })
  discover(
    @CurrentUser() user: { sub: string },
    @Body() dto: DiscoverEmailProductProposalsDto,
  ) {
    this.assertAllowed();
    return this.proposals.discover({
      userId: user.sub,
      messageIds: dto.messageIds,
      limit: dto.limit,
    });
  }

  @Get()
  @ApiOkResponse({
    description: 'Propuestas y evidencia de sus correos de origen.',
    type: EmailProductProposalResponseDto,
    isArray: true,
  })
  list(
    @CurrentUser() user: { sub: string },
    @Query() query: ListEmailProductProposalsDto,
  ) {
    this.assertAllowed();
    return this.proposals.list(user.sub, query.status);
  }

  @Patch(':proposalId')
  @ApiOkResponse({
    description: 'Propuesta editable antes de aprobarla.',
    type: EmailProductProposalResponseDto,
  })
  update(
    @CurrentUser() user: { sub: string },
    @Param('proposalId') proposalId: string,
    @Body() dto: UpdateEmailProductProposalDto,
  ) {
    this.assertAllowed();
    return this.proposals.update(user.sub, proposalId, dto);
  }

  @Post(':proposalId/approve')
  @ApiBody({ type: ApproveEmailProductProposalDto, required: false })
  @ApiOkResponse({
    description:
      'Vincula el producto indicado (o lo crea desde el borrador sin cuerpo) y reevalúa señales.',
    type: EmailProductProposalResponseDto,
  })
  approve(
    @CurrentUser() user: { sub: string },
    @Param('proposalId') proposalId: string,
    @Body() dto: ApproveEmailProductProposalDto,
  ) {
    this.assertAllowed();
    return this.proposals.approve({
      userId: user.sub,
      proposalId,
      productId: dto?.productId,
    });
  }

  @Post(':proposalId/discard')
  @ApiOkResponse({
    description: 'Descarta una propuesta pendiente.',
    type: EmailProductProposalResponseDto,
  })
  discard(
    @CurrentUser() user: { sub: string },
    @Param('proposalId') proposalId: string,
  ) {
    this.assertAllowed();
    return this.proposals.discard(user.sub, proposalId);
  }

  private assertAllowed(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new NotFoundException();
    }
  }
}
