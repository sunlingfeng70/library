import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiProvider } from './ai-provider.service';

export interface SimilarRecord {
  recordId: string;
  distance: number;
}

const toVectorLiteral = (vector: number[]): string => `[${vector.join(',')}]`;

/**
 * 书目嵌入的存取（pgvector）。嵌入生成失败或向量服务不可用时静默降级，
 * 保证编目/检索主流程不因向量能力缺失而失败。
 */
@Injectable()
export class EmbeddingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly provider: AiProvider,
  ) {}

  async embedAndStore(recordId: string, text: string): Promise<void> {
    try {
      const vector = await this.provider.embed(text);
      if (!vector || vector.length === 0) {
        return;
      }
      await this.dataSource.query(
        `INSERT INTO "bibliographic_embedding" ("record_id", "embedding")
         VALUES ($1, $2::vector)
         ON CONFLICT ("record_id") DO UPDATE
           SET "embedding" = EXCLUDED.embedding, "created_at" = now()`,
        [recordId, toVectorLiteral(vector)],
      );
    } catch {
      // 向量能力降级：不影响主流程
    }
  }

  async searchSimilar(queryVector: number[], limit: number): Promise<SimilarRecord[]> {
    try {
      const rows = await this.dataSource.query<{ record_id: string; distance: string }[]>(
        `SELECT "record_id", "embedding" <=> $1::vector AS "distance"
         FROM "bibliographic_embedding"
         ORDER BY "embedding" <=> $1::vector
         LIMIT $2`,
        [toVectorLiteral(queryVector), limit],
      );
      return rows.map((row) => ({ recordId: row.record_id, distance: Number(row.distance) }));
    } catch {
      return [];
    }
  }
}
