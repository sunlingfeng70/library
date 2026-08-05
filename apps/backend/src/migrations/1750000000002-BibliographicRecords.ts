import { MigrationInterface, QueryRunner } from 'typeorm';

export class BibliographicRecords1750000000002 implements MigrationInterface {
  name = 'BibliographicRecords1750000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "bibliographic_record" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" character varying NOT NULL,
        "author" character varying,
        "publisher" character varying,
        "isbn" character varying,
        "category" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bibliographic_record_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_bibliographic_record_isbn" UNIQUE ("isbn")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "bibliographic_record"`);
  }
}