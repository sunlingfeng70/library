import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EntityManager, DataSource, Repository } from 'typeorm';
import { InstitutionConfig, DEFAULT_INSTITUTION_CONFIG } from '../admin/institution-config.entity';
import { Copy, CopyStatus } from '../copies/copy.entity';
import { Reservation, ReservationStatus } from './reservation.entity';

export interface ReservationView {
  id: string;
  copyId: string;
  copyBarcode: string;
  status: ReservationStatus;
  pickupDeadline: Date | null;
  cancelledReason: string | null;
  createdAt: Date;
}

export interface ReservationCapability {
  enabled: boolean;
  holdDays: number;
}

function toView(res: Reservation, copy: Copy): ReservationView {
  return {
    id: res.id,
    copyId: copy.id,
    copyBarcode: copy.barcode,
    status: res.status,
    pickupDeadline: res.pickupDeadline,
    cancelledReason: res.cancelledReason,
    createdAt: res.createdAt,
  };
}

function isActive(status: ReservationStatus): boolean {
  return status === ReservationStatus.Pending || status === ReservationStatus.Allocated;
}

@Injectable()
export class ReservationsService {
  constructor(
    @InjectRepository(Reservation) private readonly reservations: Repository<Reservation>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async capability(): Promise<ReservationCapability> {
    const config = await this.ensureConfig();
    return { enabled: config.reservationEnabled, holdDays: config.reservationHoldDays };
  }

  async create(readerId: string, copyId: string): Promise<ReservationView> {
    return this.dataSource.transaction(async (manager) => {
      const config = await this.loadConfig(manager);
      if (!config.reservationEnabled) {
        throw new BadRequestException('本馆未开通预约服务');
      }

      const copy = await manager.getRepository(Copy).findOne({ where: { id: copyId } });
      if (!copy) {
        throw new NotFoundException('馆藏副本不存在');
      }
      if (copy.status !== CopyStatus.Borrowed) {
        throw new BadRequestException(`仅可预约当前在借的副本（当前状态：${copy.status}）`);
      }

      const active = await manager.getRepository(Reservation).findOne({
        where: { copyId, readerId },
      });
      if (active && isActive(active.status)) {
        throw new BadRequestException('你已预约该副本，无需重复预约');
      }

      const saved = await manager.getRepository(Reservation).save(
        manager.getRepository(Reservation).create({
          copyId,
          readerId,
          status: ReservationStatus.Pending,
          pickupDeadline: null,
          cancelledReason: null,
        }),
      );
      return toView(saved, copy);
    });
  }

  async listMine(readerId: string): Promise<ReservationView[]> {
    await this.sweepExpired();
    const rows = await this.reservations.find({
      where: { readerId },
      relations: { copy: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map((res) => toView(res, res.copy));
  }

  async deleteOwn(readerId: string, reservationId: string): Promise<{ id: string }> {
    return this.dataSource.transaction(async (manager) => {
      const res = await manager.getRepository(Reservation).findOne({
        where: { id: reservationId, readerId },
        relations: { copy: true },
      });
      if (!res) {
        throw new NotFoundException('预约记录不存在');
      }
      if (res.status === ReservationStatus.Fulfilled) {
        throw new BadRequestException('该预约已完成借出，无法取消');
      }
      if (res.status === ReservationStatus.Cancelled) {
        throw new BadRequestException('该预约已取消');
      }

      const copyWasOnHold = res.copy.status === CopyStatus.OnHold;
      res.status = ReservationStatus.Cancelled;
      res.cancelledReason = '读者取消';
      await manager.getRepository(Reservation).save(res);

      if (copyWasOnHold) {
        await this.cascade(manager, res.copy);
      }
      return { id: res.id };
    });
  }

  async allocateNextOnReturn(manager: EntityManager, copyId: string): Promise<boolean> {
    const config = await this.loadConfig(manager);
    if (!config.reservationEnabled) {
      return false;
    }
    const next = await manager.getRepository(Reservation).findOne({
      where: { copyId, status: ReservationStatus.Pending },
      order: { createdAt: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
    if (!next) {
      return false;
    }
    next.status = ReservationStatus.Allocated;
    next.pickupDeadline = new Date(Date.now() + config.reservationHoldDays * 24 * 60 * 60 * 1000);
    await manager.getRepository(Reservation).save(next);
    return true;
  }

  async fulfillOnCheckout(
    manager: EntityManager,
    readerId: string,
    copyId: string,
  ): Promise<void> {
    const res = await manager.getRepository(Reservation).findOne({
      where: { copyId, readerId, status: ReservationStatus.Allocated },
    });
    if (!res) {
      throw new BadRequestException('该副本处于预约保留中，但当前读者没有对应的到书预约');
    }
    res.status = ReservationStatus.Fulfilled;
    res.pickupDeadline = null;
    await manager.getRepository(Reservation).save(res);
  }

  async sweepExpired(): Promise<number> {
    const now = new Date();
    const allocated = await this.reservations.find({
      where: { status: ReservationStatus.Allocated },
      relations: { copy: true },
    });
    let cancelled = 0;
    for (const res of allocated) {
      if (!res.pickupDeadline || res.pickupDeadline.getTime() >= now.getTime()) {
        continue;
      }
      const didCancel = await this.dataSource.transaction<boolean>(async (manager) => {
        const locked = await manager.getRepository(Reservation).findOne({
          where: { id: res.id },
          relations: { copy: true },
        });
        if (!locked || !isActive(locked.status)) {
          return false;
        }
        locked.status = ReservationStatus.Cancelled;
        locked.cancelledReason = '超时未领取';
        await manager.getRepository(Reservation).save(locked);
        await this.cascade(manager, locked.copy);
        return true;
      });
      if (didCancel) {
        cancelled += 1;
      }
    }
    return cancelled;
  }

  private async cascade(manager: EntityManager, copy: Copy): Promise<void> {
    const allocated = await this.allocateNextOnReturn(manager, copy.id);
    if (allocated) {
      await manager.getRepository(Copy).update(
        { id: copy.id },
        { status: CopyStatus.OnHold },
      );
      return;
    }
    await manager.getRepository(Copy).update(
      { id: copy.id, status: CopyStatus.OnHold },
      { status: CopyStatus.Available },
    );
  }

  private async loadConfig(manager: EntityManager): Promise<InstitutionConfig> {
    let config = await manager.getRepository(InstitutionConfig).findOne({ where: { id: 1 } });
    if (!config) {
      config = manager.getRepository(InstitutionConfig).create({
        id: 1,
        ...DEFAULT_INSTITUTION_CONFIG,
      });
      config = await manager.getRepository(InstitutionConfig).save(config);
    }
    return config;
  }

  private ensureConfig(): Promise<InstitutionConfig> {
    return this.dataSource.transaction((manager) => this.loadConfig(manager));
  }
}
