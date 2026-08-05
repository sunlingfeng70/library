import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Staff } from '../../staff/staff.entity';
import { AuthPrincipal } from '../auth-principal';
import { ROLES_KEY } from '../decorators/roles.decorator';

interface RequestWithUser {
  user?: AuthPrincipal;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Staff) private readonly staff: Repository<Staff>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<
      Staff['role'][] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user || user.kind !== 'staff') {
      throw new ForbiddenException('insufficient role');
    }
    const staff = await this.staff.findOne({ where: { id: user.id } });
    if (!staff || !requiredRoles.includes(staff.role)) {
      throw new ForbiddenException('insufficient role');
    }
    return true;
  }
}