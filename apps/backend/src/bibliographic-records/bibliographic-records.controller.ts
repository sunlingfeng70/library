import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permission } from '../staff/staff.entity';
import {
  BibliographicRecordsService,
  CreateBibliographicRecordDto,
  SearchBibliographicRecordsQuery,
} from './bibliographic-records.service';

@Controller('bibliographic-records')
export class BibliographicRecordsController {
  constructor(private readonly records: BibliographicRecordsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.Cataloging)
  create(@Body() dto: CreateBibliographicRecordDto) {
    return this.records.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  search(@Query() query: SearchBibliographicRecordsQuery) {
    return this.records.search(query);
  }
}