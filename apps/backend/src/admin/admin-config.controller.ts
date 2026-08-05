import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StaffRole } from '../staff/staff.entity';
import {
  AdminConfigService,
  CreateReaderTypeDto,
  UpdateReaderTypeDto,
  UpsertLoanRuleDto,
} from './admin-config.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.Administrator)
export class AdminConfigController {
  constructor(private readonly config: AdminConfigService) {}

  @Get('loan-rules')
  listLoanRules() {
    return this.config.listLoanRules();
  }

  @Put('loan-rules/:readerType')
  upsertLoanRule(@Param('readerType') readerType: string, @Body() dto: UpsertLoanRuleDto) {
    return this.config.upsertLoanRule(readerType, dto);
  }

  @Get('reader-types')
  listReaderTypes() {
    return this.config.listReaderTypes();
  }

  @Post('reader-types')
  createReaderType(@Body() dto: CreateReaderTypeDto) {
    return this.config.createReaderType(dto);
  }

  @Patch('reader-types/:code')
  updateReaderType(@Param('code') code: string, @Body() dto: UpdateReaderTypeDto) {
    return this.config.updateReaderType(code, dto);
  }
}