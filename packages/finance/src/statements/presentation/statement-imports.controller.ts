import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, RequiresEnabledModule } from '@personal-os/core';
import {
  StatementImportsService,
  type StatementUploadFile,
} from '../application/statement-imports.service';
import { STATEMENT_UPLOAD_MAX_BYTES } from '../application/statement-import.constants';
import { ApplyStatementImportDto } from './dto/apply-statement-import.dto';
import { StatementImportUploadDto } from './dto/statement-import-upload.dto';
import { UpdateStatementLineDto } from './dto/update-statement-line.dto';

@ApiTags('finance')
@ApiBearerAuth('access-token')
@RequiresEnabledModule('finance')
@Controller('finance')
export class StatementImportsController {
  constructor(private readonly imports: StatementImportsService) {}

  @Post('cards/:id/statements/import')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a credit-card statement PDF and parse it' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: STATEMENT_UPLOAD_MAX_BYTES },
    }),
  )
  importCardStatement(
    @CurrentUser('sub') userId: string,
    @Param('id') cardId: string,
    @UploadedFile() file: StatementUploadFile | undefined,
    @Body() body: StatementImportUploadDto,
  ) {
    return this.imports.createFromUpload({
      userId,
      cardId,
      accountId: null,
      file,
      password: body.password,
    });
  }

  @Post('accounts/:id/statements/import')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a bank-account statement PDF and parse it' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: STATEMENT_UPLOAD_MAX_BYTES },
    }),
  )
  importAccountStatement(
    @CurrentUser('sub') userId: string,
    @Param('id') accountId: string,
    @UploadedFile() file: StatementUploadFile | undefined,
    @Body() body: StatementImportUploadDto,
  ) {
    return this.imports.createFromUpload({
      userId,
      cardId: null,
      accountId,
      file,
      password: body.password,
    });
  }

  @Get('statement-imports/:id')
  @ApiOperation({
    summary: 'Statement import status, header and reconciliation',
  })
  get(@CurrentUser('sub') userId: string, @Param('id') importId: string) {
    return this.imports.getImport(userId, importId);
  }

  @Patch('statement-imports/:id/lines/:lineId')
  @ApiOperation({ summary: 'Change one line decision or its matched movement' })
  updateLine(
    @CurrentUser('sub') userId: string,
    @Param('id') importId: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateStatementLineDto,
  ) {
    return this.imports.updateLine({
      userId,
      importId,
      lineId,
      decision: dto.decision,
      transactionId: dto.transactionId,
    });
  }

  @Post('statement-imports/:id/apply')
  @ApiOperation({ summary: 'Create the selected rows and close the period' })
  apply(
    @CurrentUser('sub') userId: string,
    @Param('id') importId: string,
    @Body() dto: ApplyStatementImportDto,
  ) {
    return this.imports.apply({
      userId,
      importId,
      adjust: dto.adjust ?? false,
    });
  }

  @Delete('statement-imports/:id')
  @ApiOperation({ summary: 'Discard a statement import' })
  async discard(
    @CurrentUser('sub') userId: string,
    @Param('id') importId: string,
  ) {
    await this.imports.discard(userId, importId);
    return { success: true };
  }
}
