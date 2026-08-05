import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Copy } from '../copies/copy.entity';
import { Reader } from '../readers/reader.entity';

@Entity('loan')
@Index('UQ_loan_active_copy', ['copyId'], { unique: true, where: '"returned_at" IS NULL' })
export class Loan {
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

  @Column({ name: 'borrowed_at' })
  borrowedAt!: Date;

  @Column({ name: 'due_at' })
  dueAt!: Date;

  @Column({ name: 'returned_at', type: 'timestamp', nullable: true })
  returnedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
