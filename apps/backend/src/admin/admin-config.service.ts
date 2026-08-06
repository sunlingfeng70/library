import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Repository } from 'typeorm';
import { LoanRule } from '../loans/loan-rule.entity';
import { ReaderType } from '../readers/reader-type.entity';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const DEFAULT_LOAN_RULE = {
  maxActiveLoans: 5,
  loanDurationDays: 30,
  fineDailyFeeCents: 50,
  graceDays: 3,
  renewalLimit: 1,
} as const;

export class UpsertLoanRuleDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  maxActiveLoans!: number;

  @IsInt()
  @Min(1)
  @Max(3650)
  loanDurationDays!: number;

  @IsInt()
  @Min(0)
  @Max(100000)
  fineDailyFeeCents!: number;

  @IsInt()
  @Min(0)
  @Max(365)
  graceDays!: number;

  @IsInt()
  @Min(0)
  @Max(100)
  renewalLimit!: number;
}

export class CreateReaderTypeDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  code!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class UpdateReaderTypeDto {
  @Transform(trimString)
  @IsString()
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export interface LoanRuleView {
  readerType: string;
  maxActiveLoans: number;
  loanDurationDays: number;
  fineDailyFeeCents: number;
  graceDays: number;
  renewalLimit: number;
}

export interface ReaderTypeView {
  code: string;
  name: string;
  enabled: boolean;
}

function toRuleView(rule: LoanRule): LoanRuleView {
  return {
    readerType: rule.readerType,
    maxActiveLoans: rule.maxActiveLoans,
    loanDurationDays: rule.loanDurationDays,
    fineDailyFeeCents: rule.fineDailyFeeCents,
    graceDays: rule.graceDays,
    renewalLimit: rule.renewalLimit,
  };
}

function toTypeView(type: ReaderType): ReaderTypeView {
  return { code: type.code, name: type.name, enabled: type.enabled };
}

@Injectable()
export class AdminConfigService {
  constructor(
    @InjectRepository(LoanRule) private readonly loanRules: Repository<LoanRule>,
    @InjectRepository(ReaderType) private readonly readerTypes: Repository<ReaderType>,
  ) {}

  async listLoanRules(): Promise<LoanRuleView[]> {
    const rows = await this.loanRules.find({ order: { readerType: 'ASC' } });
    return rows.map(toRuleView);
  }

  async upsertLoanRule(readerType: string, dto: UpsertLoanRuleDto): Promise<LoanRuleView> {
    const type = await this.readerTypes.findOne({ where: { code: readerType } });
    if (!type) {
      throw new NotFoundException('读者类型不存在');
    }
    const existing = await this.loanRules.findOne({ where: { readerType } });
    const rule = existing
      ? existing
      : this.loanRules.create({
          readerType,
          ...DEFAULT_LOAN_RULE,
        });
    rule.maxActiveLoans = dto.maxActiveLoans;
    rule.loanDurationDays = dto.loanDurationDays;
    rule.fineDailyFeeCents = dto.fineDailyFeeCents;
    rule.graceDays = dto.graceDays;
    rule.renewalLimit = dto.renewalLimit;
    const saved = await this.loanRules.save(rule);
    return toRuleView(saved);
  }

  async listReaderTypes(): Promise<ReaderTypeView[]> {
    const rows = await this.readerTypes.find({ order: { code: 'ASC' } });
    return rows.map(toTypeView);
  }

  async createReaderType(dto: CreateReaderTypeDto): Promise<ReaderTypeView> {
    const code = dto.code.trim();
    const existing = await this.readerTypes.findOne({ where: { code } });
    if (existing) {
      throw new BadRequestException('读者类型已存在');
    }
    const created = await this.readerTypes.save(
      this.readerTypes.create({
        code,
        name: dto.name.trim(),
        enabled: dto.enabled ?? true,
      }),
    );
    return toTypeView(created);
  }

  async updateReaderType(code: string, dto: UpdateReaderTypeDto): Promise<ReaderTypeView> {
    const type = await this.readerTypes.findOne({ where: { code } });
    if (!type) {
      throw new NotFoundException('读者类型不存在');
    }
    if (dto.name !== undefined) {
      type.name = dto.name.trim();
    }
    if (dto.enabled !== undefined) {
      type.enabled = dto.enabled;
    }
    const saved = await this.readerTypes.save(type);
    return toTypeView(saved);
  }
}