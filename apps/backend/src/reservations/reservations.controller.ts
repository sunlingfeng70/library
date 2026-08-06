import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthPrincipal } from '../auth/auth-principal';
import { ReservationsService } from './reservations.service';

export class CreateReservationDto {
  @IsString()
  @IsNotEmpty()
  copyId!: string;
}

function assertReader(user: AuthPrincipal): void {
  if (user.kind !== 'reader') {
    throw new ForbiddenException('仅读者可预约');
  }
}

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get('capability')
  @UseGuards(JwtAuthGuard)
  capability() {
    return this.reservations.capability();
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateReservationDto, @CurrentUser() user: AuthPrincipal) {
    assertReader(user);
    return this.reservations.create(user.id, dto.copyId.trim());
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  listMine(@CurrentUser() user: AuthPrincipal) {
    assertReader(user);
    return this.reservations.listMine(user.id);
  }

  @Delete('me/:id')
  @UseGuards(JwtAuthGuard)
  deleteOwn(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    assertReader(user);
    return this.reservations.deleteOwn(user.id, id);
  }
}