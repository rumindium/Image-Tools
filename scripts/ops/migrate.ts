#!/usr/bin/env bun
/**
 * Migrations arrive with lane B (phase 3, docs/0-DATABASE.md §5). Saying so is better than exiting 0
 * silently, which looks like a successful migration of an empty schema.
 */
if (!process.env.DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set; there is nothing to migrate in phase 0.');
  process.exit(1);
}

console.log('· db:migrate: no migrations yet. The jobs/usage_daily schema lands with phase 3.');
console.log('  See docs/0-DATABASE.md §2 for the schema this will create.');
