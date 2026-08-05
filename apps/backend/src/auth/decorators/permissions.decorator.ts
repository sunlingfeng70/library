import { SetMetadata } from '@nestjs/common';
import { PermissionName } from '../auth-principal';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: PermissionName[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);