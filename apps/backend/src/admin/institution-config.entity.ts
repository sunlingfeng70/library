import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum InstitutionType {
  Public = 'public',
  School = 'school',
}

export const DEFAULT_INSTITUTION_CONFIG = {
  institutionType: InstitutionType.Public,
  reservationEnabled: true,
  reservationHoldDays: 3,
} as const;

@Entity('institution_config')
export class InstitutionConfig {
  @PrimaryColumn({ type: 'int', default: 1 })
  id!: number;

  @Column({ name: 'institution_type', type: 'varchar', default: InstitutionType.Public })
  institutionType!: InstitutionType;

  @Column({ name: 'reservation_enabled', type: 'boolean', default: true })
  reservationEnabled!: boolean;

  @Column({ name: 'reservation_hold_days', type: 'int', default: 3 })
  reservationHoldDays!: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}