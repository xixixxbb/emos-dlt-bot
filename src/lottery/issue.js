import { randomBytes, createHash } from 'node:crypto'
import { db } from '../db/index.js'
import { logger, utc, dateInTz, zonedToUtc } from '../util/index.js'
import { GAME } from '../config/game.js'
import { config } from '../config/index.js'

/**
 * 期号状态机（计划书 §2.1）：selling → closed → drawing → drawn → settled
 * 异常态：draw_failed / settle_partial（可 /admin draw 重跑）
 */

/** 业务时区今日期号 YYYYMMDD */
export function todayIssueNo(d = new Date()) {
  return dateInTz(d).replaceAll('-', '')
}

/** 当期（selling/closed 中最近一期） */
export function getCurrentIssue() {
  return db
    .prepare(`SELECT * FROM issues WHERE status IN ('selling','closed') ORDER BY issue_no DESC LIMIT 1`)
    .get()
}

export function getIssue(issueNo) {
  return db.prepare('SELECT * FROM issues WHERE issue_no = ?').get(issueNo)
}

/** 期号是否可投注（状态 selling 且距停售 > 提前量） */
export function canBet(issue) {
  if (!issue || issue.status !== 'selling') return false
  const close = new Date(issue.sale_close_at.replace(' ', 'T') + 'Z').getTime()
  return Date.now() < close - GAME.SALE_CLOSE_LEAD_MIN * 60_000
}

/**
 * 开新期（SELL_CRON / 管理员触发 / 启动兜底）
 * seed 开售即入库（保密），seed_hash 对外公布
 */
export function openNewIssue(d = new Date()) {
  const issueNo = todayIssueNo(d)
  const existing = getIssue(issueNo)
  if (existing) return existing
  const saleDate = dateInTz(d)
  const saleClose = utc(zonedToUtc(saleDate, config.SALE_CLOSE_TIME))
  const drawAt = utc(zonedToUtc(saleDate, config.DRAW_TIME))
  const seed = randomBytes(32).toString('hex')
  const seedHash = createHash('sha256').update(seed).digest('hex')
  db.prepare(
    `INSERT INTO issues (issue_no, status, sale_close_at, draw_at, seed_hash, seed, rolled_in)
     VALUES (?, 'selling', ?, ?, ?, ?, ?)`
  ).run(issueNo, saleClose, drawAt, seedHash, seed, currentRollover())
  const issue = getIssue(issueNo)
  logger.info({ issue: issueNo, seedHash }, '新期开售')
  return issue
}

/** 当前滚存余额（最近一期期末值） */
export function currentRollover() {
  const row = db.prepare(`SELECT balance FROM rollover_ledger ORDER BY issue_no DESC LIMIT 1`).get()
  return row?.balance ?? 0
}

/** 停售：selling → closed */
export function closeIssue(issueNo) {
  const r = db.prepare(`UPDATE issues SET status='closed' WHERE issue_no=? AND status='selling'`).run(issueNo)
  return r.changes > 0
}

/** CAS 状态流转 */
export function casIssue(issueNo, from, to) {
  const r = db.prepare(`UPDATE issues SET status=? WHERE issue_no=? AND status=?`).run(to, issueNo, from)
  return r.changes > 0
}

/** 入账时累加销售额（事务内调用） */
export function addSales(issueNo, amount) {
  db.prepare(`UPDATE issues SET sales = sales + ? WHERE issue_no = ?`).run(amount, issueNo)
}

export const issueLabel = (issue) => `第 ${issue.issue_no} 期`
