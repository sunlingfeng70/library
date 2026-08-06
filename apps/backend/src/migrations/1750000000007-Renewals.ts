import { MigrationInterface, QueryRunner } from 'typeorm';

export class Renewals1750000000007 implements MigrationInterface {
  name = 'Renewals1750000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loan_rule"
        ADD COLUMN "renewal_limit" integer NOT NULL DEFAULT 1
    `);
    await queryRunner.query(`
      ALTER TABLE "loan"
        ADD COLUMN "renewal_count" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loan" DROP COLUMN "renewal_count"`);
    await queryRunner.query(`ALTER TABLE "loan_rule" DROP COLUMN "renewal_limit"`);
  }
}