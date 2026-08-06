import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Copy } from '../copies/copy.entity';
import { Reader } from '../readers/reader.entity';

export enum ReservationStatus {
  Pending = 'pending',
  Allocated = 'allocated',
  Fulfilled = 'fulfilled',
  Cancelled = 'cancelled',
}

@Entity('reservation')
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'copy_id' })
  copyId!: string;

  @ManyToOne(() => Copy, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'copy_id' })
  copy!: Copy;

  @Column({ name: 'reader_id' })
  readerId!: string;

  @ManyToOne(() => Reader, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reader_id' })
  reader!: Reader;

  @Column({ type: 'enum', enum: ReservationStatus, default: ReservationStatus.Pending })
  status!: ReservationStatus;

  @Column({ name: 'pickup_deadline', type: 'timestamp', nullable: true })
  pickupDeadline!: Date | null;

  @Column({ name: 'cancelled_reason', type: 'varchar', nullable: true })
  cancelledReason!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}