import 'dotenv/config';
import { DataSource } from 'typeorm';
import { migrationDataSourceOptions } from './database/database-options';

export default new DataSource(migrationDataSourceOptions(process.env));