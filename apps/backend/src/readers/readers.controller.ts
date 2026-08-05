import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permission } from '../staff/staff.entity';
import { CreateReaderDto, ReadersService } from './readers.service';

@Controller('readers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReadersController {
  constructor(private readonly readers: ReadersService) {}

  @Post()
  @RequirePermissions(Permission.Circulation)
  create(@Body() dto: CreateReaderDto) {
    return this.readers.create(dto);
  }

  @Get()
  @RequirePermissions(Permission.Circulation)
  list() {
    return this.readers.list();
  }

  @Get(':id')
  @RequirePermissions(Permission.Circulation)
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.readers.findById(id);
  }
}