import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { InstitutionConfig } from '../admin/institution-config.entity';
import { Copy } from '../copies/copy.entity';
import { Reservation } from './reservation.entity';
import { ReservationsController } from './reservations.controller';
import { ReservationScheduler } from './reservation-scheduler.service';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [TypeOrmModule.forFeature([Reservation, Copy, InstitutionConfig]), AuthModule],
  controllers: [ReservationsController],
  providers: [ReservationsService, ReservationScheduler],
  exports: [ReservationsService],
})
export class ReservationsModule {}
