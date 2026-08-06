import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ReservationsService } from './reservations.service';

const SWEEP_INTERVAL_MS = 60 * 1000;

@Injectable()
export class ReservationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly reservations: ReservationsService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    this.timer = setInterval(() => {
      void this.reservations
        .sweepExpired()
        .then((count) => {
          if (count > 0) {
            this.logger.log(`超时未领取自动取消预约 ${count} 条`);
          }
        })
        .catch((error: unknown) => this.logger.error('预约超时清理失败', error));
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
