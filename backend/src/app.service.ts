// Backs the health-check controller: reports process status and probes the
// database connection so failures surface as a normal JSON response, not a crash.
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
      // Swallow the error and report it in the body so the endpoint itself
      // stays reachable even when the DB is down.
      return {
        status: 'error',
        database: 'down',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
