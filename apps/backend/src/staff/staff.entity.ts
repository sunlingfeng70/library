import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

export enum StaffRole {
  Librarian = 'librarian',
  Administrator = 'administrator',
}

export enum Permission {
  Cataloging = 'cataloging',
  Circulation = 'circulation',
  Fine = 'fine',
  Reporting = 'reporting',
}

@Entity('staff')
@Unique(['username'])
export class Staff {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  username!: string;

  @Column({ name: 'password_hash' })
  passwordHash!: string;

  @Column({ name: 'role', type: 'enum', enum: StaffRole })
  role!: StaffRole;

  @Column({
    type: 'enum',
    enum: Permission,
    array: true,
    default: [],
  })
  permissions!: Permission[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}