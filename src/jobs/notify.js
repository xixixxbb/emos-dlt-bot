import { db } from '../db/index.js'
import { logger, esc } from '../util/index.js'
import { config } from '../config/index.js'
import { LEVEL_NAMES } from '../lottery/match.js'

/**
 * 开奖公示推送（计划书 §7.4）
 * - 全体绑定用户私聊推送（25 msg/s 限速由 grammY autoRetry transformer 承担）
 * - 可选频道公示
 * 失败（block 等）静默记录，不重试
 */

export function buildDrawMessage(issue) {
  const stat = db
    .prepare(
      `SELECT level, COUNT(*) n, SUM(amount) total FROM prizes WHERE issue_no=? GROUP BY level ORDER BY level`
    )
    .all(issue.issue_no)
  const lines = [
    `🎯 <b>第 ${esc(issue.issue_no)} 期 开奖结果</b>`,
    '',
    `前区：<b>${esc(issue.draw_front)}</b> + 后区：<b>${esc(issue.draw_back)}</b>`,
    '',
    '<b>各奖级</b>',
  ]
  if (stat.length) {
    for (const s of stat) {
      lines.push(`${LEVEL_NAMES[s.level]}：${s.n} 注 · 单注 ${s.total / s.n | 0} 萝卜`)
    }
  } else {
    lines.push('本期无人中奖，奖池全额滚存 🎁')
  }
  lines.push(
    '',
    `销售额：${issue.sales} · 奖池：${issue.pool_total} · 滚存结余：<b>${issue.rolled_out}</b>`,
    '',
    `🔒 可验证公平：种子哈希已在开售时公布，本期种子：`,
    `<code>${esc(issue.seed)}</code>`,
    `验证：node scripts/verify-draw.js ${esc(issue.issue_no)}`
  )
  return lines.join('\n')
}

export async function pushDrawResult(bot, issueNo) {
  const issue = db.prepare('SELECT * FROM issues WHERE issue_no=?').get(issueNo)
  if (!issue || !issue.draw_front) return { users: 0, channel: false }
  const text = buildDrawMessage(issue)

  // 频道公示（可选）
  let channelOk = false
  if (config.CHANNEL_ID) {
    try {
      await bot.api.sendMessage(config.CHANNEL_ID, text, { parse_mode: 'HTML' })
      channelOk = true
    } catch (e) {
      logger.warn({ err: e.message }, '频道公示失败')
    }
  }

  // 全员推送
  const users = db.prepare(`SELECT tg_id FROM users WHERE is_banned=0`).all()
  let sent = 0
  let failed = 0
  for (const u of users) {
    try {
      await bot.api.sendMessage(u.tg_id, text, { parse_mode: 'HTML' })
      sent++
    } catch {
      failed++
    }
  }
  logger.info({ issue: issueNo, sent, failed, channelOk }, '开奖推送完成')
  return { users: sent, failed, channel: channelOk }
}
