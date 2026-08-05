import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';

export type ConfigSource =
  | { get(key: string, fallback?: string): string | undefined }
  | Record<string, string | undefined>;

export interface DatabaseConnection {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

function isConfigService(
  source: ConfigSource,
): source is { get(key: string, fallback?: string): string | undefined } {
  return typeof (source as { get?: unknown }).get === 'function';
}

function resolve(source: ConfigSource, key: string, fallback: string): string {
  if (isConfigService(source)) {
    return source.get(key, fallback) ?? fallback;
  }
  return source[key] ?? fallback;
}

function testDatabaseName(): string {
  return process.env.NODE_ENV === 'test' ? 'library_test' : 'library';
}

export function connectionFrom(config: ConfigSource): DatabaseConnection {
  return {
    host: resolve(config, 'DB_HOST', 'localhost'),
    port: parseInt(resolve(config, 'DB_PORT', '5433'), 10),
    username: resolve(config, 'DB_USER', 'library'),
    password: resolve(config, 'DB_PASSWORD', 'library'),
    database: resolve(config, 'DB_NAME', testDatabaseName()),
  };
}

export function databaseOptions(config: ConfigService): TypeOrmModuleOptions {
  const connection = connectionFrom(config);
  return {
    type: 'postgres',
    ...connection,
    synchronize: false,
    autoLoadEntities: true,
  };
}

export function migrationDataSourceOptions(config: ConfigSource): DataSourceOptions {
  const connection = connectionFrom(config);
  return {
    type: 'postgres',
    ...connection,
    synchronize: false,
    entities: [join(process.cwd(), 'src', '**', '*.entity.ts')],
    migrations: [join(process.cwd(), 'src', 'migrations', '*.{ts,js}')],
  };
}