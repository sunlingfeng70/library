import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { LoanRule } from '../loans/loan-rule.entity';
import { ReaderType } from '../readers/reader-type.entity';
import { Staff } from '../staff/staff.entity';
import { AdminConfigController } from './admin-config.controller';
import { AdminConfigService } from './admin-config.service';

@Module({
  imports: [TypeOrmModule.forFeature([LoanRule, ReaderType, Staff]), AuthModule],
  controllers: [AdminConfigController],
  providers: [AdminConfigService],
})
export class AdminConfigModule {}
