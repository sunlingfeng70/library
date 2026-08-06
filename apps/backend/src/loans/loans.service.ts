import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { IsNotEmpty, IsString } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { Copy, CopyStatus } from '../copies/copy.entity';
import { Reader } from '../readers/reader.entity';
import { Fine } from './fine.entity';
import { LoanRule } from './loan-rule.entity';
import { Loan } from './loan.entity';

export class CheckoutDto {
  @IsString()
  @IsNotEmpty()
  readerCardNumber!: string;

  @IsString()
  @IsNotEmpty()
  barcode!: string;
}

export class ReturnDto {
  @IsString()
  @IsNotEmpty()
  barcode!: string;
}

export interface LoanView {
  id: string;
  copyBarcode: string;
  readerId: string;
  borrowedAt: Date;
  dueAt: Date;
  returnedAt: Date | null;
  renewalCount: number;
}

export interface ReturnView extends LoanView {
  fine?: { id: string; amountCents: number; reason: string } | null;
}

export interface FineView {
  id: string;
  loanId: string;
  readerId: string;
  amountCents: number;
  reason: string;
  settledAt: Date | null;
  createdAt: Date;
}

function toView(loan: Loan, barcode: string): LoanView {
  return {
    id: loan.id,
    copyBarcode: barcode,
    readerId: loan.readerId,
    borrowedAt: loan.borrowedAt,
    dueAt: loan.dueAt,
    returnedAt: loan.returnedAt,
    renewalCount: loan.renewalCount,
  };
}

function millisPerDay(): number {
  return 24 * 60 * 60 * 1000;
}

function overdueDays(returnedAt: Date, dueAt: Date, graceDays: number): number {
  const graceEndMs = dueAt.getTime() + graceDays * millisPerDay();
  const lateMs = returnedAt.getTime() - graceEndMs;
  if (lateMs <= 0) {
    return 0;
  }
  return Math.floor(lateMs / millisPerDay());
}

@Injectable()
export class LoansService {
  constructor(
    @InjectRepository(Loan) private readonly loans: Repository<Loan>,
    @InjectRepository(Fine) private readonly fines: Repository<Fine>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async checkout(dto: CheckoutDto): Promise<LoanView> {
    return this.dataSource.transaction(async (manager) => {
      const reader = await manager
        .getRepository(Reader)
        .createQueryBuilder('reader')
        .setLock('pessimistic_write')
        .where('reader.card_number = :cardNumber', {
          cardNumber: dto.readerCardNumber.trim(),
        })
        .getOne();
      if (!reader) {
        throw new NotFoundException('读者不存在');
      }

      const copy = await manager
        .getRepository(Copy)
        .findOne({ where: { barcode: dto.barcode.trim() } });
      if (!copy) {
        throw new NotFoundException('馆藏副本不存在');
      }
      if (copy.status !== CopyStatus.Available) {
        throw new BadRequestException(`馆藏副本不在馆（当前状态：${copy.status}）`);
      }

      const rule = await manager
        .getRepository(LoanRule)
        .findOne({ where: { readerType: reader.readerType } });
      if (!rule) {
        throw new BadRequestException('该读者类型的借阅规则未配置');
      }

      const active = await manager
        .getRepository(Loan)
        .createQueryBuilder('loan')
        .where('loan.reader_id = :readerId', { readerId: reader.id })
        .andWhere('loan.returned_at IS NULL')
        .getCount();
      if (active >= rule.maxActiveLoans) {
        throw new BadRequestException(
          `超出可借额度（上限 ${rule.maxActiveLoans} 本，当前在借 ${active} 本）`,
        );
      }

      const now = new Date();
      const dueAt = new Date(now.getTime() + rule.loanDurationDays * 24 * 60 * 60 * 1000);

      const updated = await manager.getRepository(Copy).update(
        { id: copy.id, status: CopyStatus.Available },
        { status: CopyStatus.Borrowed },
      );
      if (!updated.affected || updated.affected === 0) {
        throw new BadRequestException('馆藏副本不在馆，可能已被借出');
      }

      const saved = await manager.getRepository(Loan).save(
        manager.getRepository(Loan).create({
          copyId: copy.id,
          readerId: reader.id,
          borrowedAt: now,
          dueAt,
          returnedAt: null,
        }),
      );

      return toView(saved, copy.barcode);
    });
  }

  async listByReader(readerId: string): Promise<LoanView[]> {
    const loans = await this.loans.find({
      where: { readerId },
      relations: { copy: true },
      order: { borrowedAt: 'DESC' },
    });
    return loans.map((loan) => toView(loan, loan.copy.barcode));
  }

  async returnCopy(dto: ReturnDto): Promise<ReturnView> {
    return this.dataSource.transaction(async (manager) => {
      const copy = await manager
        .getRepository(Copy)
        .findOne({ where: { barcode: dto.barcode.trim() } });
      if (!copy) {
        throw new NotFoundException('馆藏副本不存在');
      }

      const loan = await manager
        .getRepository(Loan)
        .createQueryBuilder('loan')
        .where('loan.copy_id = :copyId', { copyId: copy.id })
        .andWhere('loan.returned_at IS NULL')
        .setLock('pessimistic_write')
        .getOne();
      if (!loan) {
        throw new BadRequestException('该副本当前不在借');
      }

      const now = new Date();
      loan.returnedAt = now;
      const saved = await manager.getRepository(Loan).save(loan);

      const updatedCopy = await manager.getRepository(Copy).update(
        { id: copy.id, status: CopyStatus.Borrowed },
        { status: CopyStatus.Available },
      );
      if (!updatedCopy.affected || updatedCopy.affected === 0) {
        throw new BadRequestException('副本状态异常，归还已回滚');
      }

      const reader = await manager.getRepository(Reader).findOne({
        where: { id: loan.readerId },
      });
      if (!reader) {
        throw new BadRequestException('借阅记录的读者不存在');
      }
      const rule = await manager
        .getRepository(LoanRule)
        .findOne({ where: { readerType: reader.readerType } });
      if (!rule) {
        throw new BadRequestException('该读者类型的借阅规则未配置');
      }

      const days = overdueDays(now, loan.dueAt, rule.graceDays);
      let fine: Fine | null = null;
      if (days > 0) {
        const amountCents = days * rule.fineDailyFeeCents;
        fine = await manager.getRepository(Fine).save(
          manager.getRepository(Fine).create({
            loanId: loan.id,
            readerId: loan.readerId,
            amountCents,
            reason: `逾期 ${days} 天`,
            settledAt: null,
          }),
        );
      }

      return { ...toView(saved, copy.barcode), fine: fine ? { id: fine.id, amountCents: fine.amountCents, reason: fine.reason } : null };
    });
  }

  async renew(readerId: string, loanId: string): Promise<LoanView> {
    return this.dataSource.transaction(async (manager) => {
      const loan = await manager.getRepository(Loan).findOne({
        where: { id: loanId, readerId },
        relations: { copy: true },
      });
      if (!loan) {
        throw new NotFoundException('借阅记录不存在');
      }
      if (loan.returnedAt) {
        throw new BadRequestException('该借阅已归还，无法续借');
      }

      const reader = await manager.getRepository(Reader).findOne({
        where: { id: loan.readerId },
      });
      if (!reader) {
        throw new BadRequestException('借阅记录的读者不存在');
      }
      const rule = await manager
        .getRepository(LoanRule)
        .findOne({ where: { readerType: reader.readerType } });
      if (!rule) {
        throw new BadRequestException('该读者类型的借阅规则未配置');
      }
      if (loan.renewalCount >= rule.renewalLimit) {
        throw new BadRequestException(
          `已达到续借次数上限（${rule.renewalLimit} 次）`,
        );
      }

      loan.renewalCount += 1;
      loan.dueAt = new Date(
        loan.dueAt.getTime() + rule.loanDurationDays * 24 * 60 * 60 * 1000,
      );
      const saved = await manager.getRepository(Loan).save(loan);
      return toView(saved, loan.copy.barcode);
    });
  }

  async settle(fineId: string): Promise<FineView> {
    const fine = await this.fines.findOne({ where: { id: fineId } });
    if (!fine) {
      throw new NotFoundException('罚款记录不存在');
    }
    if (fine.settledAt) {
      throw new BadRequestException('罚款已结清');
    }
    fine.settledAt = new Date();
    const saved = await this.fines.save(fine);
    return this.toFineView(saved);
  }

  private toFineView(fine: Fine): FineView {
    return {
      id: fine.id,
      loanId: fine.loanId,
      readerId: fine.readerId,
      amountCents: fine.amountCents,
      reason: fine.reason,
      settledAt: fine.settledAt,
      createdAt: fine.createdAt,
    };
  }
}