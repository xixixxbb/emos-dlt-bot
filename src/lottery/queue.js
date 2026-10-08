import { db } from '../db/index.js'
import { logger, utc, nextRetryAt } from '../util/index.js'
import { GAME } from '../config/game.js'
import { transferToUser } from '../emos/pay.js'
import { splitCarrot } from '../util/index.js'

/**
 * 派奖/退款执行器（计划书 §7.3 步骤 6）
 * transfer_queue：prize（派奖）/ refund（迟到退款）
 * - 金额 > 50000 自动拆分（部分成功保留余量续传）
 * - 失败指数退避重试，超限置 failed + 告警
 */

async function processQueueRow(row) {
  const user = db.prepare('SELECT * FROM users WHERE tg_id=?').get(row.tg_id)
  if (!user) {
    db.prepare(`UPDATE transfer_queue SET attempts=?, last_error=? WHERE id=?`).run(
      row.attempts + 1, 'user not found（未绑定）', row.id
    )
    return 'error'
  }
  const parts = splitCarrot(row.amount, GAME.TRANSFER_LIMIT)
  let done = 0
  let lastErr = null
  for (const part of parts) {
    try {
      await transferToUser(user.emos_user_id, part)
      done += part
    } catch (e) {
      lastErr = e.message
      break
    }
  }

  if (done >= row.amount) {
    // 全额成功：更新业务状态并出队
    if (row.kind === 'prize') {
      db.prepare(
        `UPDATE prizes SET status='transferred' WHERE issue_no=
          (SELECT issue_no FROM transfer_queue WHERE id=?) AND tg_id=? AND status='pending'`
      ).run(row.id, row.tg_id)
    } else if (row.kind === 'refund') {
      db.prepare(`UPDATE orders SET refunded=2 WHERE id=?`).run(row.ref_id) // 2 = 已退
    }
    db.prepare(`DELETE FROM transfer_queue WHERE id=?`).run(row.id)
    logger.info({ queueId: row.id, kind: row.kind, tg: row.tg_id, amount: row.amount }, '转账成功')
    return 'done'
  }

  if (done > 0) {
    // 部分成功：剩余额度继续重试
    db.prepare(
      `UPDATE transfer_queue SET amount=?, attempts=?, last_error=?, next_retry_at=? WHERE id=?`
    ).run(row.amount - done, row.attempts + 1, `部分成功后中断: ${lastErr}`, nextRetryAt(row.attempts), row.id)
    return 'partial'
  }

  const attempts = row.attempts + 1
  if (attempts >= GAME.TRANSFER_RETRY_MAX) {
    db.prepare(
      `UPDATE transfer_queue SET attempts=?, last_error=?, next_retry_at=NULL WHERE id=?`
    ).run(attempts, lastErr, row.id)
    logger.error({ queueId: row.id, kind: row.kind, err: lastErr }, '转账重试超限，需人工介入')
    return 'failed'
  }
  db.prepare(`UPDATE transfer_queue SET attempts=?, last_error=?, next_retry_at=? WHERE id=?`).run(
    attempts, lastErr, nextRetryAt(attempts), row.id
  )
  return 'error'
}

export async function processTransferQueue() {
  const rows = db
    .prepare(
      `SELECT * FROM transfer_queue
       WHERE next_retry_at IS NULL OR next_retry_at <= datetime('now')
       ORDER BY id LIMIT 50`
    )
    .all()
  const stat = { done: 0, partial: 0, error: 0, failed: 0 }
  for (const row of rows) {
    const r = await processQueueRow(row)
    stat[r] = (stat[r] || 0) + 1
  }
  if (stat.failed > 0 && globalThis.__notifyAdmin) {
    globalThis.__notifyAdmin(`⚠️ 派奖队列有 ${stat.failed} 条重试超限，请检查 transfer_queue`)
  }
  return stat
}
