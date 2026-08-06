import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AdminConfigModule } from './admin/admin-config.module';
import { AuthModule } from './auth/auth.module';
import { BibliographicRecordsModule } from './bibliographic-records/bibliographic-records.module';
import { CopiesModule } from './copies/copies.module';
import { databaseOptions } from './database/database-options';
import { LoansModule } from './loans/loans.module';
import { ReadersModule } from './readers/readers.module';
import { ReservationsModule } from './reservations/reservations.module';
import { StaffModule } from './staff/staff.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => databaseOptions(config),
    }),
    AuthModule,
    AdminConfigModule,
    BibliographicRecordsModule,
    CopiesModule,
    LoansModule,
    ReadersModule,
    ReservationsModule,
    StaffModule,
  ],
  controllers: [AppController],
})
export class AppModule {}