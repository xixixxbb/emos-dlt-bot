import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from './index.js'
import { logger } from '../util/index.js'

/** 版本化迁移（计划书 §3.3）：新增变更时向 MIGRATIONS 追加，不改历史 */
const MIGRATIONS = [
  { version: 1, name: 'init schema', file: 'schema.sql' },
]

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function runMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT,
    applied_at TEXT DEFAULT (datetime('now'))
  )`)
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version))
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    const sql = fs.readFileSync(path.join(__dirname, m.file), 'utf8')
    const apply = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name)
    })
    apply()
    logger.info({ version: m.version, name: m.name }, 'migration applied')
  }
}

// 支持独立运行：npm run migrate / node src/db/migrate.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations()
  console.log('✓ migrations done')
}
