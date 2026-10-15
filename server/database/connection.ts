type DatabaseEnvironment = Record<string, string | undefined>;

export function databaseConnectionOptions(environment: DatabaseEnvironment, migration = false) {
  const max = migration ? 1 : Number(environment.POSTGRESQL_POOL_MAX || 10);
  if (!Number.isInteger(max) || max < 1 || max > 50) {
    throw new Error('POSTGRESQL_POOL_MAX must be an integer between 1 and 50');
  }
  const ssl = environment.POSTGRESQL_SSL;
  if (ssl !== undefined && ssl !== '' && ssl !== 'true' && ssl !== 'false') {
    throw new Error('POSTGRESQL_SSL must be true or false');
  }
  return {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    ...(ssl === 'true' ? { ssl: true as const } : {}),
  };
}

export function migrationDatabaseUrl(environment: DatabaseEnvironment) {
  return environment.POSTGRESQL_MIGRATION_URL || environment.POSTGRESQL_URL || '';
}
