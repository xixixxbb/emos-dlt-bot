import { config } from '../config/index.js'
import { db } from '../db/index.js'
import { fmtTz, esc } from '../util/index.js'
import { getCurrentIssue, issueLabel, currentRollover } from '../lottery/issue.js'
import { fairnessBlurb } from '../lottery/fair.js'

/** 主菜单文案（已绑定用户） */
export async function sendMainMenu(ctx) {
  const issue = getCurrentIssue()
  const rollover = currentRollover()
  const lines = [
    '🎰 <b>EMOS 大乐透</b>',
    '',
    issue
      ? [
          `<b>${esc(issueLabel(issue))}</b>`,
          `奖池：<b>${Math.floor(issue.sales * config.PAYOUT_RATE) + rollover}</b> 萝卜（含滚存 ${rollover}）`,
          `停售：${fmtTz(issue.sale_close_at)} · 开奖：${fmtTz(issue.draw_at)}`,
        ].join('\n')
      : '当前无在售期次',
    '',
    '<b>指令</b>',
    '/bet 投注 · /quickpick 机选一注',
    '/issues 当期信息 · /result 往期结果',
    '/mybets 我的投注 · /balance 萝卜余额',
    '/help 玩法说明',
  ]
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
}

/** /issues：当期详情 + 公平性哈希 */
export async function sendIssues(ctx) {
  const issue = getCurrentIssue()
  if (!issue) {
    await ctx.reply('当前无在售期次，请等待下一期开售。')
    return
  }
  const rollover = currentRollover()
  const estPool = Math.floor(issue.sales * config.PAYOUT_RATE) + rollover
  await ctx.reply(
    [
      `🎰 <b>${esc(issueLabel(issue))}</b>`,
      '',
      `状态：${issue.status === 'selling' ? '售卖中' : '已停售'}（${fmtTz(issue.sale_close_at)} 截止）`,
      `开奖时间：${fmtTz(issue.draw_at)}`,
      `当期销售：${issue.sales} 萝卜`,
      `滚存余额：<b>${rollover}</b> 萝卜`,
      `预计奖池：约 ${estPool} 萝卜`,
      '',
      fairnessBlurb(issue.seed_hash),
    ].join('\n'),
    { parse_mode: 'HTML' }
  )
}

const LEVEL_NAME = (level) =>
  ({
    1: '一等奖 5+2', 2: '二等奖 5+1', 3: '三等奖 5+0', 4: '四等奖 4+2',
    5: '五等奖 4+1', 6: '六等奖 3+2', 7: '七等奖 4+0', 8: '八等奖 3+1/2+2', 9: '九等奖',
  })[level]

/** /result [期号]：开奖结果 + 奖池分配 */
export async function sendResult(ctx, arg) {
  let issue
  if (arg?.trim()) {
    issue = db.prepare('SELECT * FROM issues WHERE issue_no=?').get(arg.trim())
  } else {
    issue = db.prepare(`SELECT * FROM issues WHERE draw_front IS NOT NULL ORDER BY issue_no DESC LIMIT 1`).get()
  }
  if (!issue || !issue.draw_front) {
    await ctx.reply('暂无开奖结果。')
    return
  }
  const stat = db
    .prepare(`SELECT level, COUNT(*) n, SUM(amount) total FROM prizes WHERE issue_no=? GROUP BY level ORDER BY level`)
    .all(issue.issue_no)
  const prizeLines = stat.length
    ? stat.map((s) => `${LEVEL_NAME(s.level)}：${s.n} 注 · 单注 ${(s.total / s.n) | 0} 萝卜`).join('\n')
    : '本期无人中奖，奖池滚存 🎁'
  await ctx.reply(
    [
      `🎯 <b>${esc(issueLabel(issue))} 开奖结果</b>`,
      '',
      `前区：<b>${esc(issue.draw_front)}</b>`,
      `后区：<b>${esc(issue.draw_back)}</b>`,
      '',
      '<b>奖金分配</b>',
      prizeLines,
      '',
      `销售额 ${issue.sales} · 奖池 ${issue.pool_total} · 滚存结余 ${issue.rolled_out}`,
      `种子：<code>${esc(issue.seed)}</code>`,
      `验证：node scripts/verify-draw.js ${esc(issue.issue_no)}`,
    ].join('\n'),
    { parse_mode: 'HTML' }
  )
}

/** /mybets [期号] */
export async function sendMyBets(ctx, arg) {
  const issueNo = arg?.trim() || getCurrentIssue()?.issue_no
  if (!issueNo) {
    await ctx.reply('当前无在售期次。')
    return
  }
  const rows = db
    .prepare(
      `SELECT b.front, b.back, o.status FROM bets b JOIN orders o ON o.id=b.order_id
       WHERE b.tg_id=? AND b.issue_no=? ORDER BY b.id LIMIT 50`
    )
    .all(ctx.from.id, issueNo)
  if (!rows.length) {
    await ctx.reply(`第 ${issueNo} 期没有你的投注。发送 /bet 开始投注。`)
    return
  }
  const body = rows
    .map((r) => `${esc(r.front)} + ${esc(r.back)}${r.status !== 'paid' ? '（待支付）' : ''}`)
    .join('\n')
  await ctx.reply(
    [`📋 <b>第 ${esc(issueNo)} 期 我的投注</b>（${rows.length} 注）`, '', `<code>${body}</code>`].join('\n'),
    { parse_mode: 'HTML' }
  )
}
