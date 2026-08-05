import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReaderTypes1750000000006 implements MigrationInterface {
  name = 'ReaderTypes1750000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reader_type" (
        "code" character varying NOT NULL,
        "name" character varying NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reader_type_code" PRIMARY KEY ("code")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "reader_type" ("code", "name", "enabled") VALUES
        ('student', '学生', true),
        ('teacher', '教师', true),
        ('adult', '成人', true),
        ('child', '少儿', true)
    `);

    await queryRunner.query(
      `ALTER TABLE "reader" ALTER COLUMN "reader_type" TYPE character varying USING reader_type::text`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_rule" ALTER COLUMN "reader_type" TYPE character varying USING reader_type::text`,
    );

    await queryRunner.query(`
      ALTER TABLE "reader"
        ADD CONSTRAINT "FK_reader_reader_type"
        FOREIGN KEY ("reader_type") REFERENCES "reader_type"("code") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "loan_rule"
        ADD CONSTRAINT "FK_loan_rule_reader_type"
        FOREIGN KEY ("reader_type") REFERENCES "reader_type"("code") ON DELETE RESTRICT
    `);

    await queryRunner.query(`DROP TYPE "public"."reader_type_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."reader_type_enum" AS ENUM ('student', 'teacher', 'adult', 'child')`);
    await queryRunner.query(
      `ALTER TABLE "loan_rule" DROP CONSTRAINT "FK_loan_rule_reader_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reader" DROP CONSTRAINT "FK_reader_reader_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_rule" ALTER COLUMN "reader_type" TYPE "public"."reader_type_enum" USING reader_type::text::"public"."reader_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "reader" ALTER COLUMN "reader_type" TYPE "public"."reader_type_enum" USING reader_type::text::"public"."reader_type_enum"`,
    );
    await queryRunner.query(`DROP TABLE "reader_type"`);
  }
}