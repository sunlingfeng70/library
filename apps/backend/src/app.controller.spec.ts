import { HttpException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';

function controllerWithDatabase(responds: boolean): AppController {
  const dataSource = {
    query: jest.fn().mockImplementation(() =>
      responds ? Promise.resolve([{ '?column?': 1 }]) : Promise.reject(new Error('connection refused')),
    ),
  } as unknown as DataSource;
  return new AppController(dataSource);
}

describe('AppController', () => {
  it('reports ok when the database responds', async () => {
    const controller = controllerWithDatabase(true);
    await expect(controller.health()).resolves.toEqual({ status: 'ok', database: 'up' });
  });

  it('throws 503 when the database is unreachable', async () => {
    const controller = controllerWithDatabase(false);
    await expect(controller.health()).rejects.toThrow(HttpException);
  });
});