import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config/index.js'

// 确保数据目录存在
fs.mkdirSync(path.dirname(path.resolve(config.DB_PATH)), { recursive: true })

export const db = new Database(config.DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')
