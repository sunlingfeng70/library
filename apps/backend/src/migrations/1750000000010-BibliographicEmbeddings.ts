import { MigrationInterface, QueryRunner } from 'typeorm';

export class BibliographicEmbeddings1750000000010 implements MigrationInterface {
  name = 'BibliographicEmbeddings1750000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "bibliographic_embedding" (
        "record_id" uuid NOT NULL,
        "embedding" vector(768) NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bibliographic_embedding" PRIMARY KEY ("record_id"),
        CONSTRAINT "FK_bibliographic_embedding_record" FOREIGN KEY ("record_id")
          REFERENCES "bibliographic_record" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_bibliographic_embedding_hnsw" ON "bibliographic_embedding"
        USING hnsw ("embedding" vector_cosine_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "bibliographic_embedding"`);
  }
}