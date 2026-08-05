import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller()
export class AppController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('health')
  async health() {
    const databaseUp = await this.isDatabaseUp();
    const payload = {
      status: databaseUp ? 'ok' : 'error',
      database: databaseUp ? 'up' : 'down',
    };
    if (!databaseUp) {
      throw new HttpException(payload, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return payload;
  }

  private async isDatabaseUp(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}