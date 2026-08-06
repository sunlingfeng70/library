import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { BibliographicRecord } from '../bibliographic-records/bibliographic-record.entity';

export enum CopyStatus {
  Available = 'available',
  Borrowed = 'borrowed',
  OnHold = 'on_hold',
  Damaged = 'damaged',
  OffShelf = 'off_shelf',
}

@Entity('copy')
@Unique(['barcode'])
export class Copy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  barcode!: string;

  @Column({ type: 'enum', enum: CopyStatus, default: CopyStatus.Available })
  status!: CopyStatus;

  @Column({ name: 'bibliographic_record_id' })
  bibliographicRecordId!: string;

  @ManyToOne(() => BibliographicRecord, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bibliographic_record_id' })
  bibliographicRecord!: BibliographicRecord;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}