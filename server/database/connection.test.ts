import { describe, expect, it } from 'bun:test';
import { databaseConnectionOptions, migrationDatabaseUrl } from './connection';

describe('hosted PostgreSQL configuration', () => {
  it('uses a separate migration URL and one migration connection', () => {
    const env = {
      POSTGRESQL_URL: 'runtime',
      POSTGRESQL_MIGRATION_URL: 'migration',
      POSTGRESQL_POOL_MAX: '5',
      POSTGRESQL_SSL: 'true',
    };
    expect(migrationDatabaseUrl(env)).toBe('migration');
    expect(databaseConnectionOptions(env)).toMatchObject({ max: 5, ssl: true });
    expect(databaseConnectionOptions(env, true).max).toBe(1);
    expect(migrationDatabaseUrl({ POSTGRESQL_URL: 'runtime' })).toBe('runtime');
  });

  it('rejects unsafe pool sizes and invalid SSL representation', () => {
    for (const value of ['0', '-1', '51', '1.5', 'abc']) {
      expect(() => databaseConnectionOptions({ POSTGRESQL_POOL_MAX: value })).toThrow();
    }
    expect(() => databaseConnectionOptions({ POSTGRESQL_SSL: 'yes' })).toThrow();
    expect(databaseConnectionOptions({})).not.toHaveProperty('ssl');
  });
});
