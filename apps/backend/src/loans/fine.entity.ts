import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Loan } from './loan.entity';
import { Reader } from '../readers/reader.entity';

@Entity('fine')
export class Fine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'loan_id' })
  loanId!: string;

  @ManyToOne(() => Loan, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'loan_id' })
  loan!: Loan;

  @Column({ name: 'reader_id' })
  readerId!: string;

  @ManyToOne(() => Reader, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reader_id' })
  reader!: Reader;

  @Column({ name: 'amount_cents', type: 'int' })
  amountCents!: number;

  @Column()
  reason!: string;

  @Column({ name: 'settled_at', type: 'timestamp', nullable: true })
  settledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}