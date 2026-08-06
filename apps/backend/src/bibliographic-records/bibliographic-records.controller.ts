import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permission } from '../staff/staff.entity';
import {
  BibliographicRecordsService,
  CreateByIsbnDto,
  CreateBibliographicRecordDto,
  NaturalSearchQuery,
  SearchBibliographicRecordsQuery,
  SuggestIsbnQuery,
  UpdateBibliographicRecordDto,
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

  @Get('natural')
  @UseGuards(JwtAuthGuard)
  naturalSearch(@Query() query: NaturalSearchQuery) {
    return this.records.naturalSearch(query.q);
  }

  @Get('isbn-suggestion')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.Cataloging)
  suggestIsbn(@Query() query: SuggestIsbnQuery) {
    return this.records.suggestIsbn(query.isbn);
  }

  @Post('by-isbn')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.Cataloging)
  createByIsbn(@Body() dto: CreateByIsbnDto) {
    return this.records.createFromIsbn(dto.isbn);
  }

  @Post(':id/reading-tags/suggest')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.Cataloging)
  suggestTags(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.suggestTags(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.Cataloging)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBibliographicRecordDto) {
    return this.records.update(id, dto);
  }
}