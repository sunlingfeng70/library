import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permission } from '../staff/staff.entity';
import { AddCopiesDto, CopiesService, UpdateCopyStatusDto } from './copies.service';

@Controller()
export class CopiesController {
  constructor(private readonly copies: CopiesService) {}

  @Post('bibliographic-records/:recordId/copies')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.Cataloging)
  addCopies(@Param('recordId', ParseUUIDPipe) recordId: string, @Body() dto: AddCopiesDto) {
    return this.copies.addCopies(recordId, dto.barcodes);
  }

  @Get('bibliographic-records/:recordId/copies')
  @UseGuards(JwtAuthGuard)
  listByRecord(@Param('recordId', ParseUUIDPipe) recordId: string) {
    return this.copies.listByRecord(recordId);
  }

  @Patch('copies/:id/status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.Cataloging)
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCopyStatusDto) {
    return this.copies.setStatus(id, dto.status);
  }
}