import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayNotEmpty, IsArray, IsEnum, IsString } from 'class-validator';
import { In, Repository } from 'typeorm';
import { BibliographicRecord } from '../bibliographic-records/bibliographic-record.entity';
import { Copy, CopyStatus } from './copy.entity';

export class AddCopiesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  barcodes!: string[];
}

export class UpdateCopyStatusDto {
  @IsEnum(CopyStatus)
  status!: CopyStatus;
}

export interface CopyView {
  id: string;
  barcode: string;
  status: CopyStatus;
  bibliographicRecordId: string;
  createdAt: Date;
}

function toView(copy: Copy): CopyView {
  return {
    id: copy.id,
    barcode: copy.barcode,
    status: copy.status,
    bibliographicRecordId: copy.bibliographicRecordId,
    createdAt: copy.createdAt,
  };
}

@Injectable()
export class CopiesService {
  constructor(
    @InjectRepository(Copy) private readonly copies: Repository<Copy>,
    @InjectRepository(BibliographicRecord)
    private readonly records: Repository<BibliographicRecord>,
  ) {}

  async addCopies(recordId: string, barcodes: string[]): Promise<CopyView[]> {
    const record = await this.records.findOne({ where: { id: recordId } });
    if (!record) {
      throw new NotFoundException('书目不存在');
    }
    const trimmed = barcodes.map((b) => b.trim());
    const duplicates = trimmed.filter((b, i) => trimmed.indexOf(b) !== i);
    if (duplicates.length > 0) {
      throw new BadRequestException('条码重复');
    }
    const existing = await this.copies.find({ where: { barcode: In(trimmed) } });
    if (existing.length > 0) {
      throw new BadRequestException(`条码已存在: ${existing.map((c) => c.barcode).join(', ')}`);
    }
    try {
      const created = await this.copies.save(
        trimmed.map((barcode) =>
          this.copies.create({
            barcode,
            status: CopyStatus.Available,
            bibliographicRecordId: recordId,
          }),
        ),
      );
      return created.map(toView);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new BadRequestException('条码已存在');
      }
      throw error;
    }
  }

  async listByRecord(recordId: string): Promise<CopyView[]> {
    const record = await this.records.findOne({ where: { id: recordId } });
    if (!record) {
      throw new NotFoundException('书目不存在');
    }
    const rows = await this.copies.find({
      where: { bibliographicRecordId: recordId },
      order: { createdAt: 'ASC' },
    });
    return rows.map(toView);
  }

  async setStatus(copyId: string, status: CopyStatus): Promise<CopyView> {
    if (status === CopyStatus.Borrowed) {
      throw new BadRequestException('借出状态由流通流程处理');
    }
    const copy = await this.copies.findOne({ where: { id: copyId } });
    if (!copy) {
      throw new NotFoundException('馆藏副本不存在');
    }
    copy.status = status;
    return toView(await this.copies.save(copy));
  }

  private isUniqueViolation(error: unknown): boolean {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      return (error as { code?: unknown }).code === '23505';
    }
    return false;
  }
}