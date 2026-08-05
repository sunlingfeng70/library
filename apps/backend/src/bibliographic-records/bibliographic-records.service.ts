import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Like, Repository } from 'typeorm';
import { BibliographicRecord } from './bibliographic-record.entity';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateBibliographicRecordDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  title!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  author?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  publisher?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  isbn?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  category?: string;
}

export class SearchBibliographicRecordsQuery {
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  isbn?: string;
}

export interface BibliographicRecordView {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  isbn: string | null;
  category: string | null;
  createdAt: Date;
}

function toView(record: BibliographicRecord): BibliographicRecordView {
  return {
    id: record.id,
    title: record.title,
    author: record.author,
    publisher: record.publisher,
    isbn: record.isbn,
    category: record.category,
    createdAt: record.createdAt,
  };
}

@Injectable()
export class BibliographicRecordsService {
  constructor(
    @InjectRepository(BibliographicRecord)
    private readonly records: Repository<BibliographicRecord>,
  ) {}

  async create(dto: CreateBibliographicRecordDto): Promise<BibliographicRecordView> {
    if (dto.isbn) {
      const existing = await this.records.findOne({ where: { isbn: dto.isbn } });
      if (existing) {
        throw new BadRequestException('ISBN 已存在');
      }
    }
    try {
      const created = await this.records.save(
        this.records.create({
          title: dto.title,
          author: dto.author ?? null,
          publisher: dto.publisher ?? null,
          isbn: dto.isbn ?? null,
          category: dto.category ?? null,
        }),
      );
      return toView(created);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new BadRequestException('ISBN 已存在');
      }
      throw error;
    }
  }

  async search(query: SearchBibliographicRecordsQuery): Promise<BibliographicRecordView[]> {
    const where = {
      ...(query.title ? { title: Like(`%${query.title}%`) } : {}),
      ...(query.isbn ? { isbn: Like(`%${query.isbn}%`) } : {}),
    };
    const rows = await this.records.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return rows.map(toView);
  }

  private isUniqueViolation(error: unknown): boolean {
    const err = error as { code?: string };
    return err?.code === '23505';
  }
}