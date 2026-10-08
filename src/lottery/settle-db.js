import { db } from '../db/index.js'
import { logger } from '../util/index.js'
import { computeSettlement, aggregatePayouts } from './settle.js'

/**
 * 结算持久化（draw job 调用）
 * 前置：issue.status = 'drawing'，号码已写入
 * 幂等保护：pool_total 非空 → 已结算
 */
export function settleIssue(issueNo, { payoutRate }) {
  const issue = db.prepare('SELECT * FROM issues WHERE issue_no=?').get(issueNo)
  if (!issue) throw new Error(`issue ${issueNo} not found`)
  if (issue.pool_total !== null) {
    logger.info({ issue: issueNo }, '已结算过，跳过（幂等）')
    return { already: true }
  }

  const betsRows = db
    .prepare(
      `SELECT b.id, b.tg_id, b.front, b.back FROM bets b
       JOIN orders o ON o.id = b.order_id
       WHERE b.issue_no = ? AND o.status = 'paid'`
    )
    .all(issueNo)

  const result = computeSettlement({
    sales: issue.sales || 0,
    rolloverIn: issue.rolled_in || 0,
    payoutRate,
    betsRows,
    drawFront: issue.draw_front,
    drawBack: issue.draw_back,
  })

  const persist = db.transaction(() => {
    const insPrize = db.prepare(
      `INSERT INTO prizes (issue_no, tg_id, bet_id, level, amount) VALUES (?,?,?,?,?)`
    )
    for (const p of result.payouts) {
      insPrize.run(issueNo, p.tgId, p.betId, p.level, p.amount)
    }
    // 派奖队列（按用户聚合）
    const insQueue = db.prepare(
      `INSERT INTO transfer_queue (kind, ref_id, tg_id, amount, next_retry_at) VALUES ('prize', 0, ?, ?, datetime('now'))`
    )
    for (const agg of aggregatePayouts(result.payouts)) {
      insQueue.run(agg.tgId, agg.amount)
    }
    db.prepare(
      `UPDATE issues SET pool_total=?, fixed_paid=?, float_pool=?, rolled_out=? WHERE issue_no=?`
    ).run(result.pool, result.fixedPaid, result.floatPool, result.rolloverOut, issueNo)
    db.prepare(
      `INSERT INTO rollover_ledger (issue_no, balance) VALUES (?, ?)
       ON CONFLICT(issue_no) DO UPDATE SET balance=excluded.balance`
    ).run(issueNo, result.rolloverOut)
    // 状态 drawing → drawn（持久化完成后）
    casLocal(issueNo, 'drawing', 'drawn')
  })
  persist()

  logger.info(
    { issue: issueNo, pool: result.pool, payouts: result.payouts.length, rolloverOut: result.rolloverOut },
    '结算完成'
  )
  return { already: false, result }
}

function casLocal(issueNo, from, to) {
  const r = db.prepare(`UPDATE issues SET status=? WHERE issue_no=? AND status=?`).run(to, issueNo, from)
  if (r.changes === 0) throw new Error(`状态流转失败 ${issueNo}: ${from} → ${to}`)
}
