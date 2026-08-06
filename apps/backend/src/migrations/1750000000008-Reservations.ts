import { MigrationInterface, QueryRunner } from 'typeorm';

export class Reservations1750000000008 implements MigrationInterface {
  name = 'Reservations1750000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."copy_status_enum" ADD VALUE IF NOT EXISTS 'on_hold'`,
    );
    await queryRunner.query(`
      CREATE TYPE "reservation_status_enum" AS ENUM
        ('pending', 'allocated', 'fulfilled', 'cancelled')
    `);

    await queryRunner.query(`
      CREATE TABLE "reservation" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "copy_id" uuid NOT NULL,
        "reader_id" uuid NOT NULL,
        "status" "reservation_status_enum" NOT NULL DEFAULT 'pending',
        "pickup_deadline" TIMESTAMP,
        "cancelled_reason" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reservation_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_reservation_copy" FOREIGN KEY ("copy_id")
          REFERENCES "copy"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reservation_reader" FOREIGN KEY ("reader_id")
          REFERENCES "reader"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_reservation_copy_reader_active"
        ON "reservation" ("copy_id", "reader_id")
        WHERE "status" IN ('pending', 'allocated')
    `);
    await queryRunner.query(`
      CREATE TABLE "institution_config" (
        "id" integer NOT NULL DEFAULT 1,
        "institution_type" character varying NOT NULL DEFAULT 'public',
        "reservation_enabled" boolean NOT NULL DEFAULT true,
        "reservation_hold_days" integer NOT NULL DEFAULT 3,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_institution_config_id" PRIMARY KEY ("id"),
        CONSTRAINT "CK_institution_config_singleton" CHECK ("id" = 1)
      )
    `);
    await queryRunner.query(`
      INSERT INTO "institution_config" ("id", "institution_type", "reservation_enabled", "reservation_hold_days")
      VALUES (1, 'public', true, 3)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "institution_config"`);
    await queryRunner.query(`DROP TABLE "reservation"`);
    await queryRunner.query(`DROP TYPE "reservation_status_enum"`);
    await queryRunner.query(
      `UPDATE "copy" SET "status" = 'available' WHERE "status" = 'on_hold'`,
    );
    await queryRunner.query(
      `CREATE TYPE "copy_status_enum_new" AS ENUM ('available', 'borrowed', 'damaged', 'off_shelf')`,
    );
    await queryRunner.query(`
      ALTER TABLE "copy" ALTER COLUMN "status" TYPE "copy_status_enum_new"
        USING "status"::text::"copy_status_enum_new"
    `);
    await queryRunner.query(`DROP TYPE "copy_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "copy_status_enum_new" RENAME TO "copy_status_enum"`,
    );
  }
}