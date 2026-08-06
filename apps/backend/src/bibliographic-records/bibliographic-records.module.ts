import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { Staff } from '../staff/staff.entity';
import { BibliographicRecord } from './bibliographic-record.entity';
import { BibliographicRecordsController } from './bibliographic-records.controller';
import { BibliographicRecordsService } from './bibliographic-records.service';
import { IsbnLookupService } from './isbn-lookup.service';
import { RealIsbnLookupService } from './real-isbn-lookup.service';

@Module({
  imports: [TypeOrmModule.forFeature([BibliographicRecord, Staff]), AuthModule, AiModule],
  controllers: [BibliographicRecordsController],
  providers: [
    BibliographicRecordsService,
    { provide: IsbnLookupService, useClass: RealIsbnLookupService },
  ],
  exports: [BibliographicRecordsService],
})
export class BibliographicRecordsModule {}