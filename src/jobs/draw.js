import { db } from '../db/index.js'
import { logger } from '../util/index.js'
import { casIssue } from '../lottery/issue.js'
import { deriveNumbers } from '../lottery/fair.js'
import { fmtNumbers } from '../lottery/validate.js'
import { settleIssue } from '../lottery/settle-db.js'
import { config } from '../config/index.js'

/**
 * 开奖 job（计划书 §7.3）
 * CAS 锁 → 公布 seed → 派生号码 → 结算（幂等）→ settled
 * 失败 → settle_partial / draw_failed + 告警，/admin draw 断点重跑
 */
export async function runDraw(forceIssueNo = null) {
  const issue = forceIssueNo
    ? db.prepare('SELECT * FROM issues WHERE issue_no=?').get(forceIssueNo)
    : db.prepare(`SELECT * FROM issues WHERE status='closed' ORDER BY issue_no DESC LIMIT 1`).get()
  if (!issue) return { ok: false, reason: 'no closed issue' }
  if (issue.pool_total !== null) return { ok: true, already: true, issue: issue.issue_no }

  // 1. 状态前置：closed / draw_failed / settle_partial → drawing
  if (!['closed', 'draw_failed', 'settle_partial'].includes(issue.status)) {
    return { ok: false, reason: `status ${issue.status} 不可开奖` }
  }
  // 重跑场景：draw_failed/settle_partial 直接进 drawing；正常场景 CAS 防并发
  if (issue.status === 'closed') {
    if (!casIssue(issue.issue_no, 'closed', 'drawing')) {
      return { ok: false, reason: '并发锁竞争失败' }
    }
  } else {
    db.prepare(`UPDATE issues SET status='drawing' WHERE issue_no=?`).run(issue.issue_no)
  }

  try {
    // 2. 派生号码（seed 开售时已入库）
    const { front, back } = deriveNumbers(issue.seed, issue.issue_no)
    const drawFront = fmtNumbers(front)
    const drawBack = fmtNumbers(back)
    db.prepare(`UPDATE issues SET draw_front=?, draw_back=? WHERE issue_no=?`).run(
      drawFront, drawBack, issue.issue_no
    )
    logger.info({ issue: issue.issue_no, drawFront, drawBack }, '开奖号码已派生')

    // 3. 结算（settleIssue 内部幂等 + drawing → drawn）
    await settleIssue(issue.issue_no, { payoutRate: config.PAYOUT_RATE })

    // 4. drawn → settled
    casIssue(issue.issue_no, 'drawn', 'settled')
    return { ok: true, issue: issue.issue_no, drawFront, drawBack }
  } catch (e) {
    const cur = db.prepare('SELECT status, draw_front FROM issues WHERE issue_no=?').get(issue.issue_no)
    const to = cur?.draw_front ? 'settle_partial' : 'draw_failed'
    db.prepare(`UPDATE issues SET status=? WHERE issue_no=?`).run(to, issue.issue_no)
    logger.error({ issue: issue.issue_no, err: e.message, status: to }, '开奖流程失败')
    globalThis.__notifyAdmin?.(
      `🚨 第 ${issue.issue_no} 期开奖失败（${to}）：${e.message}\n可发送 /admin draw ${issue.issue_no} 重试`
    )
    return { ok: false, reason: e.message, status: to }
  }
}
