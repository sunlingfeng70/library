import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { In, Like, Not, Raw, Repository } from 'typeorm';
import { AiProvider } from '../ai/ai-provider.service';
import { EmbeddingService } from '../ai/embedding.service';
import { ReadingTagSuggestion, ReadingTagSuggester } from '../ai/reading-tag-suggester.service';
import { SearchIntent, SearchIntentParser } from '../ai/search-intent-parser.service';
import {
  BibliographicRecord,
  READING_GRADE_LABELS,
  ReadingGrade,
} from './bibliographic-record.entity';
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

  @Transform(trimArray)
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  subjects?: string[];

  @Transform(({ value }) =>
    value === true || value === 'true'
      ? true
      : value === false || value === 'false'
        ? false
        : undefined,
  )
  @IsBoolean()
  @IsOptional()
  available?: boolean;
}

export interface NaturalSearchResult extends BibliographicRecordView {
  reason: string;
}

export class NaturalSearchQuery {
  @Transform(trimString)
  @IsString({ message: '查询词格式不正确' })
  @IsNotEmpty({ message: '查询词不能为空' })
  q!: string;
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
    private readonly intentParser: SearchIntentParser,
    private readonly aiProvider: AiProvider,
    private readonly embedding: EmbeddingService,
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
      this.embed(created.id, created);
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
      ...(await this.availabilityClause(query.available)),
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
      ...(query.subjects && query.subjects.length > 0
        ? {
            subjects: Raw(
              (alias) =>
                `EXISTS (SELECT 1 FROM unnest(${alias}) AS s WHERE s ILIKE ANY(:subjects))`,
              { subjects: query.subjects.map((s) => `%${s}%`) },
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
    this.embed(created.id, created);
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
    this.embed(saved.id, saved);
    return toView(saved);
  }

  async naturalSearch(query: string): Promise<NaturalSearchResult[]> {
    const intent = await this.intentParser.parse(query);
    const hasFilters =
      Boolean(intent.title) ||
      Boolean(intent.readingGrade) ||
      (intent.subjects?.length ?? 0) > 0 ||
      intent.available !== undefined;
    if (hasFilters) {
      const structured = await this.search({
        title: intent.title,
        readingGrade: intent.readingGrade,
        subjects: intent.subjects,
        available: intent.available,
      });
      if (structured.length > 0) {
        const reason = this.describeFilters(intent);
        return structured.map((record) => ({ ...record, reason }));
      }
    }
    return this.semanticSearch(query, intent);
  }

  private async semanticSearch(
    query: string,
    intent: SearchIntent,
  ): Promise<NaturalSearchResult[]> {
    const queryVector = await this.aiProvider.embed(query);
    if (!queryVector || queryVector.length === 0) {
      return [];
    }
    const matches = await this.embedding.searchSimilar(queryVector, 10);
    if (matches.length === 0) {
      return [];
    }
    const rows = await this.records.findBy({ id: In(matches.map((m) => m.recordId)) });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const availableIds = intent.available !== undefined ? new Set(await this.availableRecordIds()) : null;
    return matches
      .map((match) => byId.get(match.recordId))
      .filter((row): row is BibliographicRecord => row !== undefined)
      .filter((row) => this.matchesHardConstraints(row, intent, availableIds))
      .map((row) => ({ ...toView(row), reason: `与「${query}」语义相近` }));
  }

  private matchesHardConstraints(
    record: BibliographicRecord,
    intent: SearchIntent,
    availableIds: Set<string> | null,
  ): boolean {
    if (intent.readingGrade && record.readingGrade !== intent.readingGrade) {
      return false;
    }
    if (intent.available === true) {
      return availableIds !== null && availableIds.has(record.id);
    }
    if (intent.available === false) {
      return availableIds !== null && !availableIds.has(record.id);
    }
    return true;
  }

  private async availabilityClause(
    available: boolean | undefined,
  ): Promise<Record<string, unknown>> {
    if (available === undefined) {
      return {};
    }
    const ids = await this.availableRecordIds();
    if (available) {
      return ids.length > 0 ? { id: In(ids) } : { id: In([]) };
    }
    return ids.length > 0 ? { id: Not(In(ids)) } : {};
  }

  private async availableRecordIds(): Promise<string[]> {
    const rows = await this.records.query<{ id: string }[]>(
      `SELECT DISTINCT "bibliographic_record_id" AS "id"
       FROM "copy"
       WHERE "status" = 'available'`,
    );
    return rows.map((row) => row.id);
  }

  private embed(recordId: string, record: BibliographicRecord): void {
    const text = [record.title, record.category, ...(record.subjects ?? [])]
      .filter((part): part is string => Boolean(part))
      .join(' ');
    void this.embedding.embedAndStore(recordId, text);
  }

  private describeFilters(intent: SearchIntent): string {
    const parts: string[] = [];
    if (intent.title) {
      parts.push(`题名含「${intent.title}」`);
    }
    if (intent.readingGrade) {
      parts.push(`适读年级「${READING_GRADE_LABELS[intent.readingGrade]}」`);
    }
    if (intent.subjects && intent.subjects.length > 0) {
      parts.push(`学科「${intent.subjects.join('、')}」`);
    }
    if (intent.available === true) {
      parts.push('有在馆副本');
    }
    return parts.length > 0 ? `匹配${parts.join('，')}` : '匹配查询条件';
  }

  private isUniqueViolation(error: unknown): boolean {
    const err = error as { code?: string };
    return err?.code === '23505';
  }
}