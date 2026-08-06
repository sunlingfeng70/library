import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Like, Raw, Repository } from 'typeorm';
import { ReadingTagSuggestion, ReadingTagSuggester } from '../ai/reading-tag-suggester.service';
import { BibliographicRecord, ReadingGrade } from './bibliographic-record.entity';
import { IsbnLookupResult, IsbnLookupService } from './isbn-lookup.service';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimArray = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item.trim() : item)) : value;

const ISBN_PATTERN = /^(97[89][0-9]{10}|[0-9]{10})$/;

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
  @ValidateIf((o) => o.isbn !== undefined && o.isbn !== '')
  @IsString()
  @Matches(ISBN_PATTERN, { message: 'ISBN 格式不正确' })
  isbn?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  category?: string;

  @IsEnum(ReadingGrade)
  @IsOptional()
  readingGrade?: ReadingGrade;

  @Transform(trimArray)
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  subjects?: string[];
}

export class UpdateBibliographicRecordDto {
  @Transform(trimString)
  @ValidateIf((o) => o.title !== undefined)
  @IsString()
  @IsNotEmpty()
  title?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  author?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  publisher?: string;

  @Transform(trimString)
  @ValidateIf((o) => o.isbn !== undefined && o.isbn !== '')
  @IsString()
  @Matches(ISBN_PATTERN, { message: 'ISBN 格式不正确' })
  isbn?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  category?: string;

  @IsEnum(ReadingGrade)
  @IsOptional()
  readingGrade?: ReadingGrade;

  @Transform(trimArray)
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  subjects?: string[];
}

export class SuggestIsbnQuery {
  @Transform(trimString)
  @IsString()
  @Matches(ISBN_PATTERN, { message: 'ISBN 格式不正确' })
  isbn!: string;
}

export class CreateByIsbnDto {
  @Transform(trimString)
  @IsString()
  @Matches(ISBN_PATTERN, { message: 'ISBN 格式不正确' })
  isbn!: string;
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

  @IsEnum(ReadingGrade)
  @IsOptional()
  readingGrade?: ReadingGrade;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  subject?: string;
}

export interface BibliographicRecordView {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  isbn: string | null;
  category: string | null;
  readingGrade: ReadingGrade | null;
  subjects: string[] | null;
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
    readingGrade: record.readingGrade,
    subjects: record.subjects,
    createdAt: record.createdAt,
  };
}

@Injectable()
export class BibliographicRecordsService {
  constructor(
    @InjectRepository(BibliographicRecord)
    private readonly records: Repository<BibliographicRecord>,
    private readonly isbnLookup: IsbnLookupService,
    private readonly tagSuggester: ReadingTagSuggester,
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
          readingGrade: dto.readingGrade ?? null,
          subjects: dto.subjects ?? null,
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
      ...(query.readingGrade ? { readingGrade: query.readingGrade } : {}),
      ...(query.subject
        ? {
            subjects: Raw(
              (alias) =>
                `EXISTS (SELECT 1 FROM unnest(${alias}) AS s WHERE s ILIKE :subject)`,
              { subject: `%${query.subject}%` },
            ),
          }
        : {}),
    };
    const rows = await this.records.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return rows.map(toView);
  }

  async suggestIsbn(isbn: string): Promise<IsbnLookupResult> {
    const result = await this.isbnLookup.lookup(isbn);
    return result ?? {};
  }

  async createFromIsbn(isbn: string): Promise<BibliographicRecordView> {
    const suggestion = await this.isbnLookup.lookup(isbn);
    if (!suggestion?.title) {
      throw new BadRequestException('未从公开书目源检索到该 ISBN 的题名，请手工录入');
    }
    const existing = await this.records.findOne({ where: { isbn } });
    if (existing) {
      throw new BadRequestException('ISBN 已存在');
    }
    const created = await this.records.save(
      this.records.create({
        title: suggestion.title,
        author: suggestion.author ?? null,
        publisher: suggestion.publisher ?? null,
        isbn,
        category: suggestion.category ?? null,
        readingGrade: null,
        subjects: null,
      }),
    );
    return toView(created);
  }

  async suggestTags(recordId: string): Promise<ReadingTagSuggestion | null> {
    const record = await this.records.findOne({ where: { id: recordId } });
    if (!record) {
      throw new NotFoundException('书目记录不存在');
    }
    return this.tagSuggester.suggest({
      title: record.title,
      author: record.author,
      category: record.category,
    });
  }

  async update(
    id: string,
    dto: UpdateBibliographicRecordDto,
  ): Promise<BibliographicRecordView> {
    const record = await this.records.findOne({ where: { id } });
    if (!record) {
      throw new NotFoundException('书目记录不存在');
    }
    if (dto.isbn && dto.isbn !== record.isbn) {
      const existing = await this.records.findOne({ where: { isbn: dto.isbn } });
      if (existing && existing.id !== id) {
        throw new BadRequestException('ISBN 已存在');
      }
    }
    if (dto.title !== undefined) {
      record.title = dto.title;
    }
    if (dto.author !== undefined) {
      record.author = dto.author;
    }
    if (dto.publisher !== undefined) {
      record.publisher = dto.publisher;
    }
    if (dto.isbn !== undefined) {
      record.isbn = dto.isbn === '' ? null : dto.isbn;
    }
    if (dto.category !== undefined) {
      record.category = dto.category;
    }
    if (dto.readingGrade !== undefined) {
      record.readingGrade = dto.readingGrade;
    }
    if (dto.subjects !== undefined) {
      record.subjects = dto.subjects;
    }
    const saved = await this.records.save(record);
    return toView(saved);
  }

  private isUniqueViolation(error: unknown): boolean {
    const err = error as { code?: string };
    return err?.code === '23505';
  }
}