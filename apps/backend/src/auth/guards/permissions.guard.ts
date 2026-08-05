import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission, Staff, StaffRole } from '../../staff/staff.entity';
import { AuthPrincipal } from '../auth-principal';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

interface RequestWithUser {
  user?: AuthPrincipal;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Staff) private readonly staff: Repository<Staff>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user || user.kind !== 'staff') {
      throw new ForbiddenException('insufficient permissions');
    }
    const staff = await this.staff.findOne({ where: { id: user.id } });
    if (!staff) {
      throw new ForbiddenException('insufficient permissions');
    }
    if (staff.role === StaffRole.Administrator) {
      return true;
    }
    if (!required.every((p) => staff.permissions.includes(p))) {
      throw new ForbiddenException('insufficient permissions');
    }
    return true;
  }
}