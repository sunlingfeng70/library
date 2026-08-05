import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { Permission, Staff, StaffRole } from './staff.entity';

export class CreateStaffDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsEnum(StaffRole)
  role!: StaffRole;

  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions!: Permission[];
}

export class UpdateStaffPermissionsDto {
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions!: Permission[];
}

export interface StaffView {
  id: string;
  username: string;
  role: StaffRole;
  permissions: Permission[];
  createdAt: Date;
}

function toView(staff: Staff): StaffView {
  return {
    id: staff.id,
    username: staff.username,
    role: staff.role,
    permissions: staff.permissions,
    createdAt: staff.createdAt,
  };
}

@Injectable()
export class StaffService {
  constructor(
    @InjectRepository(Staff) private readonly staff: Repository<Staff>,
  ) {}

  async create(dto: CreateStaffDto): Promise<StaffView> {
    if (dto.role === StaffRole.Administrator) {
      throw new BadRequestException('系统管理员只能由初始化流程创建');
    }
    const existing = await this.staff.findOne({ where: { username: dto.username } });
    if (existing) {
      throw new BadRequestException('用户名已存在');
    }
    const created = await this.staff.save(
      this.staff.create({
        username: dto.username,
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: dto.role,
        permissions: dto.permissions,
      }),
    );
    return toView(created);
  }

  async list(): Promise<StaffView[]> {
    const rows = await this.staff.find({ order: { createdAt: 'ASC' } });
    return rows.map(toView);
  }

  async updatePermissions(id: string, permissions: Permission[]): Promise<StaffView> {
    const staff = await this.staff.findOne({ where: { id } });
    if (!staff) {
      throw new BadRequestException('馆员不存在');
    }
    if (staff.role === StaffRole.Administrator) {
      throw new BadRequestException('管理员拥有全部权限，无需单独赋权');
    }
    staff.permissions = permissions;
    return toView(await this.staff.save(staff));
  }
}