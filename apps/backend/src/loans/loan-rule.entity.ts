import { Column, Entity, PrimaryColumn } from 'typeorm';
import { ReaderType } from '../readers/reader.entity';

@Entity('loan_rule')
export class LoanRule {
  @PrimaryColumn({ name: 'reader_type', type: 'enum', enum: ReaderType })
  readerType!: ReaderType;

  @Column({ name: 'max_active_loans', type: 'int' })
  maxActiveLoans!: number;

  @Column({ name: 'loan_duration_days', type: 'int' })
  loanDurationDays!: number;
}
