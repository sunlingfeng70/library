import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { IsNotEmpty, IsString } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { Copy, CopyStatus } from '../copies/copy.entity';
import { Reader } from '../readers/reader.entity';
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

export interface LoanView {
  id: string;
  copyBarcode: string;
  readerId: string;
  borrowedAt: Date;
  dueAt: Date;
  returnedAt: Date | null;
}

function toView(loan: Loan, barcode: string): LoanView {
  return {
    id: loan.id,
    copyBarcode: barcode,
    readerId: loan.readerId,
    borrowedAt: loan.borrowedAt,
    dueAt: loan.dueAt,
    returnedAt: loan.returnedAt,
  };
}

@Injectable()
export class LoansService {
  constructor(
    @InjectRepository(Loan) private readonly loans: Repository<Loan>,
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
}