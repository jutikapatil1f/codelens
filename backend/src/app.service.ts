import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  getHealth() {
    return { status: 'ok' };
  }

  async getDbHealth() {
    try {
      // SELECT 1 round-trips to the database; cheap way to confirm connectivity.
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch (err) {
      return {
        status: 'error',
        database: 'down',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
