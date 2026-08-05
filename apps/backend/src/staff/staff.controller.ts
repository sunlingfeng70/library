import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { StaffRole } from './staff.entity';
import {
  CreateStaffDto,
  StaffService,
  UpdateStaffPermissionsDto,
} from './staff.service';

@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(StaffRole.Administrator)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Post()
  create(@Body() dto: CreateStaffDto) {
    return this.staff.create(dto);
  }

  @Get()
  list() {
    return this.staff.list();
  }

  @Patch(':id/permissions')
  updatePermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffPermissionsDto,
  ) {
    return this.staff.updatePermissions(id, dto.permissions);
  }
}