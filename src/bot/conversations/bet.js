import { db } from '../../db/index.js'
import { config } from '../../config/index.js'
import { esc, fmtTz } from '../../util/index.js'
import { getCurrentIssue, canBet, issueLabel } from '../../lottery/issue.js'
import { parseSelection, betCount, expand, quickPick, fmtNumbers } from '../../lottery/validate.js'
import { createBetOrder, submitOrderToEmos, getPendingOrder, countUserBets } from '../../lottery/order.js'

/**
 * 投注向导（计划书 §7.2）
 * /bet → 方式选择 → 选号/机选/复式/守号 → 确认 → emos 支付 → 回跳确认
 * 会话存内存（支付前无强一致需求，重启丢弃可接受）
 */

const sessions = new Map() // tg_id → {issue, mode}
const pendingConfirm = new Map() // tg_id → {issue, bets, amount}

const MODE_KB = {
  inline_keyboard: [
    [
      { text: '✍️ 自选', callback_data: 'bet:manual' },
      { text: '🎲 机选', callback_data: 'bet:quick' },
    ],
    [
      { text: '🧮 复式', callback_data: 'bet:complex' },
      { text: '⭐ 守号', callback_data: 'bet:favorite' },
    ],
    [{ text: '❌ 取消', callback_data: 'bet:cancel' }],
  ],
}

function mustBind(ctx) {
  const user = db.prepare('SELECT * FROM users WHERE tg_id=?').get(ctx.from.id)
  if (!user) {
    ctx.reply('请先 /bind 绑定 EMOS 账号。')
    return null
  }
  return user
}

export async function betEntry(ctx) {
  if (!mustBind(ctx)) return
  const issue = getCurrentIssue()
  if (!issue || !canBet(issue)) {
    await ctx.reply('当前不可投注（不在售卖窗口或临近停售）。')
    return
  }
  const pending = getPendingOrder(ctx.from.id, issue.issue_no)
  if (pending) {
    await ctx.reply(
      [
        '⚠️ 你有一笔待支付订单：',
        `金额 ${pending.amount} 萝卜 · 截止 ${fmtTz(pending.expires_at)}`,
        pending.pay_url ? `👉 <a href="${esc(pending.pay_url)}">继续支付</a>` : '',
        '支付完成或过期后可再投注。',
      ]
        .filter(Boolean)
        .join('\n'),
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
    )
    return
  }
  await ctx.reply('选择投注方式：', { reply_markup: MODE_KB })
}

export async function betCallback(ctx) {
  const action = (ctx.callbackQuery?.data ?? '').split(':')[1]
  if (action === 'cancel') {
    await ctx.callbackQuery.answer()
    await ctx.callbackQuery.message.delete().catch(() => {})
    return
  }
  await ctx.callbackQuery.answer()
  const issue = getCurrentIssue()
  if (!issue || !canBet(issue)) {
    await ctx.callbackQuery.message.editText('当前不可投注（可能已停售）。')
    return
  }
  switch (action) {
    case 'quick': {
      const p = quickPick()
      await confirmAndPay(ctx, issue, [{ front: fmtNumbers(p.front), back: fmtNumbers(p.back) }], true)
      break
    }
    case 'manual':
    case 'complex': {
      const isComplex = action === 'complex'
      await ctx.callbackQuery.message.editText(
        [
          isComplex ? '🧮 <b>复式投注</b>' : '✍️ <b>自选单式</b>',
          '',
          '格式：<code>01 05 12 23 34 + 03 09</code>',
          isComplex
            ? `前区 5-${config.FRONT_MAX_CHOOSE ?? 8} 个 · 后区 2-${config.BACK_MAX_CHOOSE ?? 4} 个`
            : '前区固定 5 个 · 后区固定 2 个',
          '',
          `⏳ 停售 ${fmtTz(issue.sale_close_at)}`,
          '直接回复本条消息输入号码（5 分钟内有效）。',
        ].join('\n'),
        { parse_mode: 'HTML' }
      )
      sessions.set(ctx.callbackQuery.from.id, {
        issue: issue.issue_no,
        mode: isComplex ? 'complex' : 'manual',
        ts: Date.now(),
      })
      break
    }
    case 'favorite': {
      const favs = db
        .prepare(`SELECT name, front, back FROM favorite_bets WHERE tg_id=? ORDER BY name LIMIT 10`)
        .all(ctx.callbackQuery.from.id)
      if (!favs.length) {
        await ctx.callbackQuery.message.editText('暂无守号。投注成功后回复「保存守号」可添加。')
        return
      }
      const kb = favs.map((f) => [
        { text: `${f.name} ${f.front}+${f.back}`, callback_data: `betfav:${f.name}` },
      ])
      kb.push([{ text: '❌ 取消', callback_data: 'bet:cancel' }])
      await ctx.callbackQuery.message.editText('选择守号：', { reply_markup: { inline_keyboard: kb } })
      break
    }
  }
}

export async function betFavCallback(ctx) {
  const name = ctx.callbackQuery.data.split(':').slice(1).join(':')
  await ctx.callbackQuery.answer()
  const fav = db.prepare(`SELECT * FROM favorite_bets WHERE tg_id=? AND name=?`).get(ctx.callbackQuery.from.id, name)
  if (!fav) {
    await ctx.callbackQuery.message.editText('守号不存在。')
    return
  }
  const issue = getCurrentIssue()
  if (!issue || !canBet(issue)) {
    await ctx.callbackQuery.message.editText('当前不可投注。')
    return
  }
  await confirmAndPay(ctx, issue, [{ front: fav.front, back: fav.back }], false)
}

/** 处理用户回复的号码（index.js 文本路由调用） */
export async function handleBetText(ctx) {
  const sess = sessions.get(ctx.from.id)
  if (!sess) return false
  sessions.delete(ctx.from.id)
  if (Date.now() - sess.ts > 5 * 60_000) {
    await ctx.reply('会话已超时，请重新 /bet。')
    return true
  }
  const issue = getCurrentIssue()
  if (!issue || issue.issue_no !== sess.issue || !canBet(issue)) {
    await ctx.reply('已停售，请等下期。')
    return true
  }
  const sel = parseSelection(ctx.message.text)
  if (!sel.ok) {
    await ctx.reply(`❌ ${esc(sel.error)}，请重新 /bet。`)
    return true
  }
  const n = betCount(sel.front, sel.back)
  if (sess.mode === 'manual' && n !== 1) {
    await ctx.reply('❌ 单式需前区 5 个 + 后区 2 个。请重新 /bet 选「复式」或修正号码。')
    return true
  }
  const bets = expand(sel.front, sel.back).map((x) => ({
    front: fmtNumbers(x.front),
    back: fmtNumbers(x.back),
  }))
  await confirmAndPay(ctx, issue, bets, false)
  return true
}

async function confirmAndPay(ctx, issue, bets, isQuickpick) {
  const already = countUserBets(ctx.from.id, issue.issue_no)
  if (already + bets.length > config.MAX_BETS_PER_USER) {
    await ctx.reply(`每期每人最多 ${config.MAX_BETS_PER_USER} 注（含待支付），请减少注数。`)
    return
  }
  const amount = bets.length * config.PRICE_PER_BET
  const label =
    bets.length === 1 ? `${bets[0].front} + ${bets[0].back}` : `共 ${bets.length} 注（详见支付后 /mybets）`
  pendingConfirm.set(ctx.from.id, { issue: issue.issue_no, bets, amount })
  await ctx.reply(
    [
      `🎫 <b>投注确认</b> — ${esc(issueLabel(issue))}`,
      '',
      isQuickpick ? `🎲 机选：${label}` : `号码：${label}`,
      `注数：${bets.length} 注 · 金额：<b>${amount}</b> 萝卜`,
      '',
      '确认后将生成 EMOS 支付订单。',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: `✅ 确认支付 ${amount} 萝卜`, callback_data: 'betgo:1' },
            { text: '❌ 取消', callback_data: 'bet:cancel' },
          ],
        ],
      },
    }
  )
}

export async function betGoCallback(ctx) {
  const p = pendingConfirm.get(ctx.from.id)
  if (!p) {
    await ctx.callbackQuery.answer('会话过期', { show_alert: false })
    await ctx.callbackQuery.message.editText('会话过期，请重新 /bet。')
    return
  }
  await ctx.callbackQuery.answer('正在创建订单…')
  pendingConfirm.delete(ctx.from.id)
  const issue = getCurrentIssue()
  if (!issue || issue.issue_no !== p.issue || !canBet(issue)) {
    await ctx.callbackQuery.message.editText('已停售，订单未创建。')
    return
  }
  let order
  try {
    const { orderId } = createBetOrder({ tgId: ctx.from.id, issueNo: p.issue, bets: p.bets, amount: p.amount })
    order = await submitOrderToEmos(orderId)
  } catch (e) {
    await ctx.callbackQuery.message.editText(`❌ 订单创建失败：${esc(e.message)}`)
    return
  }
  await ctx.callbackQuery.message.editText(
    [
      '✅ 订单已创建，请支付：',
      '',
      `👉 <a href="${esc(order.pay_url)}">点击支付 ${p.amount} 萝卜</a>`,
      '',
      `订单号：<code>${esc(order.no)}</code>`,
      `⏳ 有效期至 ${fmtTz(order.expires_at)}`,
      '支付完成后请点击 emos 页面的返回按钮回到本机器人确认。',
    ].join('\n'),
    { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
  )
}

/** /quickpick：一键机选一注直达确认 */
export async function quickPickEntry(ctx) {
  if (!mustBind(ctx)) return
  const issue = getCurrentIssue()
  if (!issue || !canBet(issue)) {
    await ctx.reply('当前不可投注（不在售卖窗口或临近停售）。')
    return
  }
  const pending = getPendingOrder(ctx.from.id, issue.issue_no)
  if (pending) {
    await ctx.reply(
      [
        '⚠️ 你有一笔待支付订单：',
        `金额 ${pending.amount} 萝卜 · 截止 ${fmtTz(pending.expires_at)}`,
        pending.pay_url ? `👉 <a href="${esc(pending.pay_url)}">继续支付</a>` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
    )
    return
  }
  const p = quickPick()
  await confirmAndPay(ctx, issue, [{ front: fmtNumbers(p.front), back: fmtNumbers(p.back) }], true)
}
