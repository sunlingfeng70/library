import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Staff } from '../staff/staff.entity';
import { Fine } from './fine.entity';
import { Loan } from './loan.entity';
import { LoanRule } from './loan-rule.entity';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';

@Module({
  imports: [TypeOrmModule.forFeature([Loan, LoanRule, Fine, Staff]), AuthModule],
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
