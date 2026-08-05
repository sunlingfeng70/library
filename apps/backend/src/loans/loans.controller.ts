import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../staff/staff.entity';
import { CheckoutDto, LoansService, ReturnDto } from './loans.service';

@Controller('loans')
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.Circulation)
  checkout(@Body() dto: CheckoutDto) {
    return this.loans.checkout(dto);
  }

  @Post('return')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.Circulation)
  returnCopy(@Body() dto: ReturnDto) {
    return this.loans.returnCopy(dto);
  }

  @Patch('fines/:id/settle')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.Fine)
  settle(@Param('id', ParseUUIDPipe) id: string) {
    return this.loans.settle(id);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  listMine(@CurrentUser() user: AuthPrincipal) {
    if (user.kind !== 'reader') {
      throw new ForbiddenException('仅读者可查看我的借阅');
    }
    return this.loans.listByReader(user.id);
  }
}
