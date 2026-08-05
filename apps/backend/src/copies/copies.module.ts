import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BibliographicRecord } from '../bibliographic-records/bibliographic-record.entity';
import { Staff } from '../staff/staff.entity';
import { Copy } from './copy.entity';
import { CopiesController } from './copies.controller';
import { CopiesService } from './copies.service';

@Module({
  imports: [TypeOrmModule.forFeature([Copy, BibliographicRecord, Staff]), AuthModule],
  controllers: [CopiesController],
  providers: [CopiesService],
  exports: [CopiesService],
})
export class CopiesModule {}