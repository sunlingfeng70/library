import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Staff } from '../staff/staff.entity';
import { BibliographicRecord } from './bibliographic-record.entity';
import { BibliographicRecordsController } from './bibliographic-records.controller';
import { BibliographicRecordsService } from './bibliographic-records.service';

@Module({
  imports: [TypeOrmModule.forFeature([BibliographicRecord, Staff]), AuthModule],
  controllers: [BibliographicRecordsController],
  providers: [BibliographicRecordsService],
  exports: [BibliographicRecordsService],
})
export class BibliographicRecordsModule {}