import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AiProvider } from '../ai/ai-provider.service';
import { BibliographicRecord } from '../bibliographic-records/bibliographic-record.entity';
import { CopyStatus } from '../copies/copy.entity';
import { Loan } from '../loans/loan.entity';
import { Reader } from '../readers/reader.entity';
import { ReaderType } from '../readers/reader-type.entity';
import {
  CollaborativeRecommendation,
  CollaborativeRecommendationSource,
} from './collaborative-recommendation-source.service';
import { buildProfile, ruleReason, scoreRecord } from './reader.profile';
import { Recommendation, Recommender } from './recommender.service';

interface AIPromptRecommendation {
  recordId: string;
  reason: string;
}

interface AIPromptResponse {
  items?: AIPromptRecommendation[];
  reasons?: Record<string, string>;
}

function isAIPromptRecommendation(value: unknown): value is AIPromptRecommendation {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const recordId = Reflect.get(value, 'recordId');
  const reason = Reflect.get(value, 'reason');
  return (
    typeof recordId === 'string' &&
    typeof reason === 'string' &&
    recordId.length > 0 &&
    reason.length > 0
  );
}

function isAIPromptResponse(value: unknown): value is AIPromptResponse {
  return Boolean(value) && typeof value === 'object';
}

function parseRecommendationReasons(raw: string | null): Map<string, string> {
  if (!raw) {
    return new Map();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isAIPromptResponse(parsed)) {
      return new Map();
    }
    const response = parsed;
    if (Array.isArray(response.items)) {
      return new Map(
        response.items
          .filter(isAIPromptRecommendation)
          .map((item) => [item.recordId, item.reason]),
      );
    }
    if (response.reasons && typeof response.reasons === 'object') {
      return new Map(Object.entries(response.reasons).filter((entry): entry is [string, string] => Boolean(entry[0]) && Boolean(entry[1])));
    }
  } catch {
    return new Map();
  }
  return new Map();
}

@Injectable()
export class RealRecommender extends Recommender {
  constructor(
    @InjectRepository(Reader) private readonly readers: Repository<Reader>,
    @InjectRepository(ReaderType) private readonly readerTypes: Repository<ReaderType>,
    @InjectRepository(Loan) private readonly loans: Repository<Loan>,
    @InjectRepository(BibliographicRecord) private readonly records: Repository<BibliographicRecord>,
    private readonly aiProvider: AiProvider,
    private readonly collaborativeSource: CollaborativeRecommendationSource,
  ) {
    super();
  }

  async recommend(readerId: string): Promise<Recommendation[]> {
    const reader = await this.readers.findOne({ where: { id: readerId } });
    if (!reader) {
      throw new NotFoundException('读者不存在');
    }
    const readerType = await this.readerTypes.findOne({ where: { code: reader.readerType } });
    const readerTypeName = readerType?.name ?? reader.readerType;

    const loans = await this.loans.find({
      where: { readerId },
      relations: { copy: { bibliographicRecord: true } },
      order: { borrowedAt: 'DESC' },
    });
    const borrowedRecords = loans
      .map((loan) => loan.copy?.bibliographicRecord)
      .filter((record): record is BibliographicRecord => Boolean(record));
    const profile = buildProfile(borrowedRecords);
    const borrowedRecordIds = new Set(profile.borrowedRecordIds);

    const availableRecordIds = new Set(await this.availableRecordIds());
    const candidates = await this.records.findBy({ id: In([...availableRecordIds].filter((id) => !borrowedRecordIds.has(id))) });
    const ranked = candidates
      .map((record) => ({ record, score: scoreRecord(profile, record, availableRecordIds) }))
      .sort((left, right) => right.score - left.score || left.record.title.localeCompare(right.record.title, 'zh-Hans-CN') || left.record.id.localeCompare(right.record.id))
      .slice(0, 10);

    const aiReasons = parseRecommendationReasons(
      await this.aiProvider.chat({
        system: `你是图书馆荐书助手。根据读者类型与借阅历史，为候选书目生成简短推荐理由。`,
        user: JSON.stringify({
          readerType: readerTypeName,
          profile,
          candidates: ranked.map(({ record }) => ({
            recordId: record.id,
            title: record.title,
            category: record.category,
            readingGrade: record.readingGrade,
            subjects: record.subjects,
          })),
        }),
        jsonObject: true,
      }),
    );

    const aiRecommendations = ranked.map(({ record, score }) => {
      const source: Recommendation['source'] = aiReasons.has(record.id) ? 'ai' : 'rule';
      return {
        recordId: record.id,
        title: record.title,
        author: record.author,
        category: record.category,
        readingGrade: record.readingGrade,
        subjects: record.subjects,
        reason: aiReasons.get(record.id) ?? ruleReason(profile, record, readerTypeName),
        score,
        source,
      };
    });

    const collaborativeRecommendations = await this.collaborativeSource.recommend(readerId);
    const collaborative = await this.mergeCollaborative(collaborativeRecommendations, availableRecordIds, borrowedRecordIds);

    return [...aiRecommendations, ...collaborative].sort(
      (left, right) => right.score - left.score || left.title.localeCompare(right.title, 'zh-Hans-CN') || left.recordId.localeCompare(right.recordId),
    );
  }

  private async availableRecordIds(): Promise<string[]> {
    const rows = await this.records.query<{ id: string }[]>(
      `SELECT DISTINCT "bibliographic_record_id" AS "id"
       FROM "copy"
       WHERE "status" = '${CopyStatus.Available}'`,
    );
    return rows.map((row) => row.id);
  }

  private async mergeCollaborative(
    recommendations: CollaborativeRecommendation[],
    availableRecordIds: Set<string>,
    borrowedRecordIds: Set<string>,
  ): Promise<Recommendation[]> {
    if (recommendations.length === 0) {
      return [];
    }
    const rows = await this.records.findBy({ id: In(recommendations.map((item) => item.recordId)) });
    const byId = new Map(rows.map((record) => [record.id, record]));
    return recommendations.flatMap((item) => {
      const record = byId.get(item.recordId);
      if (!record || !availableRecordIds.has(record.id) || borrowedRecordIds.has(record.id)) {
        return [];
      }
      const source: Recommendation['source'] = 'collaborative';
      return [{
        recordId: record.id,
        title: record.title,
        author: record.author,
        category: record.category,
        readingGrade: record.readingGrade,
        subjects: record.subjects,
        reason: item.reason,
        score: 1,
        source,
      }];
    });
  }
}
