import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsEnum, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { Reader, ReaderType } from './reader.entity';

export class CreateReaderDto {
  @IsString()
  @IsNotEmpty()
  cardNumber!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(ReaderType)
  readerType!: ReaderType;

  @IsString()
  @MinLength(6)
  initialPassword!: string;
}

export interface ReaderView {
  id: string;
  cardNumber: string;
  name: string;
  readerType: ReaderType;
  openidBound: boolean;
  createdAt: Date;
}

function toView(reader: Reader): ReaderView {
  return {
    id: reader.id,
    cardNumber: reader.cardNumber,
    name: reader.name,
    readerType: reader.readerType,
    openidBound: reader.openid !== null,
    createdAt: reader.createdAt,
  };
}

@Injectable()
export class ReadersService {
  constructor(
    @InjectRepository(Reader) private readonly readers: Repository<Reader>,
  ) {}

  async create(dto: CreateReaderDto): Promise<ReaderView> {
    const existing = await this.readers.findOne({ where: { cardNumber: dto.cardNumber } });
    if (existing) {
      throw new BadRequestException('证号已存在');
    }
    const created = await this.readers.save(
      this.readers.create({
        cardNumber: dto.cardNumber,
        name: dto.name,
        readerType: dto.readerType,
        passwordHash: await bcrypt.hash(dto.initialPassword, 10),
      }),
    );
    return toView(created);
  }

  async list(): Promise<ReaderView[]> {
    const rows = await this.readers.find({ order: { createdAt: 'ASC' } });
    return rows.map(toView);
  }

  async findById(id: string): Promise<ReaderView> {
    const reader = await this.readers.findOne({ where: { id } });
    if (!reader) {
      throw new BadRequestException('读者不存在');
    }
    return toView(reader);
  }
}