import { MigrationInterface, QueryRunner } from 'typeorm';

export class Copies1750000000003 implements MigrationInterface {
  name = 'Copies1750000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."copy_status_enum" AS ENUM ('available', 'borrowed', 'damaged', 'off_shelf')`,
    );
    await queryRunner.query(`
      CREATE TABLE "copy" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "barcode" character varying NOT NULL,
        "status" "public"."copy_status_enum" NOT NULL DEFAULT 'available',
        "bibliographic_record_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_copy_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_copy_barcode" UNIQUE ("barcode"),
        CONSTRAINT "FK_copy_bibliographic_record" FOREIGN KEY ("bibliographic_record_id")
          REFERENCES "bibliographic_record"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "copy"`);
    await queryRunner.query(`DROP TYPE "public"."copy_status_enum"`);
  }
}