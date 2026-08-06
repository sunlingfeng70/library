import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReadingTags1750000000009 implements MigrationInterface {
  name = 'ReadingTags1750000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bibliographic_record"
        ADD COLUMN "reading_grade" character varying,
        ADD COLUMN "subjects" text[]
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bibliographic_record"
        DROP COLUMN "subjects",
        DROP COLUMN "reading_grade"
    `);
  }
}
