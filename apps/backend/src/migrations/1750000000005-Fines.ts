import { MigrationInterface, QueryRunner } from 'typeorm';

export class Fines1750000000005 implements MigrationInterface {
  name = 'Fines1750000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loan_rule"
        ADD COLUMN "fine_daily_fee_cents" integer NOT NULL DEFAULT 50,
        ADD COLUMN "grace_days" integer NOT NULL DEFAULT 3
    `);
    await queryRunner.query(`
      CREATE TABLE "fine" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "loan_id" uuid NOT NULL,
        "reader_id" uuid NOT NULL,
        "amount_cents" integer NOT NULL,
        "reason" character varying NOT NULL,
        "settled_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fine_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_fine_loan" FOREIGN KEY ("loan_id")
          REFERENCES "loan"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_fine_reader" FOREIGN KEY ("reader_id")
          REFERENCES "reader"("id") ON DELETE RESTRICT
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "fine"`);
    await queryRunner.query(`
      ALTER TABLE "loan_rule"
        DROP COLUMN "fine_daily_fee_cents",
        DROP COLUMN "grace_days"
    `);
  }
}