export type StaffRoleName = 'librarian' | 'administrator';

export type PermissionName = 'cataloging' | 'circulation' | 'fine' | 'reporting';

export interface AuthPrincipal {
  id: string;
  kind: 'reader' | 'staff';
}