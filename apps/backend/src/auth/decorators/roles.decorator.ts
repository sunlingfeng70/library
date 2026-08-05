import { SetMetadata } from '@nestjs/common';
import { StaffRoleName } from '../auth-principal';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: StaffRoleName[]) => SetMetadata(ROLES_KEY, roles);