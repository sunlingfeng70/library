import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthAndReaders1750000000001 implements MigrationInterface {
  name = 'AuthAndReaders1750000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."staff_role_enum" AS ENUM ('librarian', 'administrator')`);
    await queryRunner.query(`CREATE TYPE "public"."permission_enum" AS ENUM ('cataloging', 'circulation', 'fine', 'reporting')`);
    await queryRunner.query(`CREATE TYPE "public"."reader_type_enum" AS ENUM ('student', 'teacher', 'adult', 'child')`);

    await queryRunner.query(`
      CREATE TABLE "reader" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "card_number" character varying NOT NULL,
        "name" character varying NOT NULL,
        "reader_type" "public"."reader_type_enum" NOT NULL,
        "openid" character varying,
        "password_hash" character varying NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reader_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_reader_card_number" UNIQUE ("card_number"),
        CONSTRAINT "UQ_reader_openid" UNIQUE ("openid")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "staff" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "username" character varying NOT NULL,
        "password_hash" character varying NOT NULL,
        "role" "public"."staff_role_enum" NOT NULL,
        "permissions" "public"."permission_enum" array NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_staff_username" UNIQUE ("username")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "staff"`);
    await queryRunner.query(`DROP TABLE "reader"`);
    await queryRunner.query(`DROP TYPE "public"."reader_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."permission_enum"`);
    await queryRunner.query(`DROP TYPE "public"."staff_role_enum"`);
  }
}