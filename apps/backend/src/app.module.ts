import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { BibliographicRecordsModule } from './bibliographic-records/bibliographic-records.module';
import { CopiesModule } from './copies/copies.module';
import { databaseOptions } from './database/database-options';
import { ReadersModule } from './readers/readers.module';
import { StaffModule } from './staff/staff.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => databaseOptions(config),
    }),
    AuthModule,
    BibliographicRecordsModule,
    CopiesModule,
    ReadersModule,
    StaffModule,
  ],
  controllers: [AppController],
})
export class AppModule {}