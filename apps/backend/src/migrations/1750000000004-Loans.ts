import { MigrationInterface, QueryRunner } from 'typeorm';

export class Loans1750000000004 implements MigrationInterface {
  name = 'Loans1750000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "loan" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "copy_id" uuid NOT NULL,
        "reader_id" uuid NOT NULL,
        "borrowed_at" TIMESTAMP NOT NULL DEFAULT now(),
        "due_at" TIMESTAMP NOT NULL,
        "returned_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_loan_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_loan_copy" FOREIGN KEY ("copy_id")
          REFERENCES "copy"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_loan_reader" FOREIGN KEY ("reader_id")
          REFERENCES "reader"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_loan_active_copy" ON "loan" ("copy_id") WHERE "returned_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE TABLE "loan_rule" (
        "reader_type" "public"."reader_type_enum" NOT NULL,
        "max_active_loans" integer NOT NULL,
        "loan_duration_days" integer NOT NULL,
        CONSTRAINT "PK_loan_rule_reader_type" PRIMARY KEY ("reader_type")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "loan_rule" ("reader_type", "max_active_loans", "loan_duration_days") VALUES
        ('student', 5, 30),
        ('teacher', 10, 60),
        ('adult', 5, 30),
        ('child', 3, 21)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "loan_rule"`);
    await queryRunner.query(`DROP INDEX "UQ_loan_active_copy"`);
    await queryRunner.query(`DROP TABLE "loan"`);
  }
}
