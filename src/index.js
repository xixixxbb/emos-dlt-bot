import { config } from './config/index.js'
import { logger, esc } from './util/index.js'
import { runMigrations } from './db/migrate.js'

runMigrations()

const { db } = await import('./db/index.js')
const { getUserCarrot } = await import('./emos/pay.js')
const { bindStart, handleLinkPayload } = await import('./bot/bind.js')
const { parseDeeplink } = await import('./bot/deeplink.js')
const { sendMainMenu, sendIssues, sendResult, sendMyBets } = await import('./bot/commands.js')
const { betEntry, betCallback, betGoCallback, betFavCallback, handleBetText, quickPickEntry } = await import(
  './bot/conversations/bet.js'
)
const { getCurrentIssue, openNewIssue } = await import('./lottery/issue.js')
const { confirmOrderFromEmos } = await import('./lottery/order.js')
const { runDraw } = await import('./jobs/draw.js')
const { pushDrawResult } = await import('./jobs/notify.js')
const { processTransferQueue } = await import('./lottery/queue.js')
const { reconcileOrders } = await import('./lottery/order.js')

import { Bot, GrammyError, HttpError } from 'grammy'
import { autoRetry } from '@grammyjs/auto-retry'
import cron from 'node-cron'

const bot = new Bot(config.BOT_TOKEN)
bot.api.config.use(autoRetry())

globalThis.__notifyAdmin = (text) => {
  bot.api.sendMessage(config.ADMIN_TG_ID, text).catch((e) => logger.warn({ err: e.message }, 'admin notify failed'))
}

const helpText = [
  '🎰 <b>EMOS 大乐透玩法</b>',
  '',
  '<b>玩法</b>',
  '前区从 01–35 选 5 个，后区从 01–12 选 2 个。',
  `每注 ${config.PRICE_PER_BET} 萝卜。支持单式 / 机选 / 复式 / 守号。`,
  '',
  '<b>浮动奖（奖池分配）</b>',
  '一等奖 5+2：浮动池 75% 均分（无人中滚存）',
  '二等奖 5+1：浮动池 15% 均分',
  '三等奖 5+0：浮动池 10% 均分',
  '<b>固定奖</b>',
  '四等奖 4+2：800 · 五等奖 4+1：250 · 六等奖 3+2：150',
  '七等奖 4+0：50 · 八等奖 3+1/2+2：20 · 九等奖：10',
  `总返奖率 ${Math.round(config.PAYOUT_RATE * 100)}%。`,
  '',
  '<b>公平</b>',
  'commit-reveal：开售公布种子哈希，开奖公布种子，任何人可复算。',
  '',
  '<b>指令</b>',
  '/bet 投注 · /quickpick 机选 · /issues 当期 · /result 结果',
  '/mybets 我的投注 · /balance 余额 · /bind 绑定 · /help 本说明',
].join('\n')

bot.command('start', async (ctx) => {
  const link = parseDeeplink(ctx.match?.trim() || '')
  if (link) {
    switch (link.type) {
      case 'pay_agree':
        await handlePayAgree(ctx, link)
        return
      case 'pay_refuse':
        await ctx.reply('❌ 支付未完成。可 /bet 重新投注（原订单会自动过期）。')
        return
      case 'link_agree':
        await handleLinkPayload(ctx, `emosLinkAgree-${link.token}`)
        return
      case 'link_refuse':
        await handleLinkPayload(ctx, 'emosLinkRefuse')
        return
    }
  }
  const user = db.prepare('SELECT * FROM users WHERE tg_id=?').get(ctx.from.id)
  if (!user) await bindStart(ctx)
  else await sendMainMenu(ctx, user)
})

bot.command('help', (ctx) => ctx.reply(helpText, { parse_mode: 'HTML' }))
bot.command('bind', bindStart)
bot.command('issues', sendIssues)
bot.command('result', (ctx) => sendResult(ctx, ctx.match))
bot.command('mybets', (ctx) => sendMyBets(ctx, ctx.match))

bot.command('quickpick', quickPickEntry)

bot.command('balance', async (ctx) => {
  const user = db.prepare('SELECT * FROM users WHERE tg_id=?').get(ctx.from.id)
  if (!user) return ctx.reply('请先 /bind 绑定。')
  try {
    const res = await getUserCarrot(user.emos_user_id)
    const v = res?.carrot ?? res?.data?.carrot ?? JSON.stringify(res)
    await ctx.reply(`🥕 当前可用萝卜：<b>${esc(String(v))}</b>`, { parse_mode: 'HTML' })
  } catch (e) {
    await ctx.reply(`查询失败：${esc(e.message)}`)
  }
})

bot.command('bet', betEntry)

bot.callbackQuery(/^bet:/, betCallback)
bot.callbackQuery(/^betfav:/, betFavCallback)
bot.callbackQuery(/^betgo:/, betGoCallback)

bot.on('message:text', async (ctx) => {
  if (await handleBetText(ctx)) return
  if (ctx.message.text.trim().startsWith('保存守号')) await handleSaveFavorite(ctx)
})

async function handleSaveFavorite(ctx) {
  const last = db
    .prepare(
      `SELECT b.front, b.back FROM bets b JOIN orders o ON o.id=b.order_id
       WHERE b.tg_id=? AND o.status='paid' ORDER BY b.id DESC LIMIT 1`
    )
    .get(ctx.from.id)
  if (!last) {
    await ctx.reply('没有可保存的已支付投注。')
    return
  }
  const name = `守号${Date.now() % 10000}`
  db.prepare(
    `INSERT INTO favorite_bets (tg_id, name, front, back) VALUES (?,?,?,?)
     ON CONFLICT(tg_id,name) DO UPDATE SET front=excluded.front, back=excluded.back`
  ).run(ctx.from.id, name, last.front, last.back)
  await ctx.reply(`已保存守号 <code>${esc(name)}</code>：${last.front} + ${last.back}`, { parse_mode: 'HTML' })
}

async function handlePayAgree(ctx, link) {
  const r = await confirmOrderFromEmos(link.no, 'deeplink')
  if (r.status === 'paid') {
    await ctx.reply(
      [
        '✅ <b>支付成功，投注已生效！</b>',
        '',
        `期号：第 ${esc(r.order.issue_no)} 期`,
        `注数：${r.order.bet_count} 注 · 金额：${r.order.amount} 萝卜`,
        '',
        '回复「保存守号」可收藏本次号码。',
        '开奖后将以消息推送结果，或 /result 查看。',
      ].join('\n'),
      { parse_mode: 'HTML' }
    )
  } else if (r.status === 'refunded') {
    await ctx.reply('⚠️ 收到支付，但本期已开奖。该订单将自动全额退款至你的 EMOS 账户。')
  } else if (r.status === 'already') {
    await ctx.reply('该订单已确认过，无需重复操作。')
  } else if (r.status === 'not_found') {
    await ctx.reply('未找到对应订单，请核对订单号或联系管理员。')
  } else {
    await ctx.reply('⚠️ 订单尚未支付成功，请稍后重试或联系管理员。')
  }
}

bot.catch((err) => {
  const e = err.error
  if (e instanceof GrammyError) logger.warn({ desc: e.description }, 'grammy error')
  else if (e instanceof HttpError) logger.error({ err: e.cause?.message }, 'tg http error')
  else logger.error({ err: err.stack || String(e) }, 'unhandled bot error')
})

// ———— 调度 ————
cron.schedule(config.SELL_CRON, () => {
  try {
    const issue = openNewIssue()
    logger.info({ issue: issue.issue_no }, '新期已开售')
  } catch (e) {
    logger.error({ err: e.message }, '开售失败')
    globalThis.__notifyAdmin?.(`🚨 开售失败：${e.message}`)
  }
}, { timezone: config.TZ })

cron.schedule(config.CLOSE_CRON, () => {
  try {
    const issue = getCurrentIssue()
    if (issue?.status === 'selling') {
      db.prepare(`UPDATE issues SET status='closed' WHERE issue_no=? AND status='selling'`).run(issue.issue_no)
      logger.info({ issue: issue.issue_no }, '已停售')
    }
  } catch (e) {
    logger.error({ err: e.message }, '停售失败')
  }
}, { timezone: config.TZ })

cron.schedule(config.DRAW_CRON, async () => {
  const r = await runDraw()
  if (r.ok && !r.already) {
    await pushDrawResult(bot, r.issue).catch((e) => logger.error({ err: e.message }, '推送失败'))
  }
}, { timezone: config.TZ })

cron.schedule('*/5 * * * *', async () => {
  try {
    await reconcileOrders()
  } catch (e) {
    logger.error({ err: e.message }, '对账 job 异常')
  }
})

cron.schedule('*/2 * * * *', async () => {
  try {
    await processTransferQueue()
  } catch (e) {
    logger.error({ err: e.message }, '派奖 job 异常')
  }
})

// ———— 管理员 ————
bot.command('admin', async (ctx) => {
  if (ctx.from.id !== config.ADMIN_TG_ID) return
  const [sub, ...rest] = (ctx.match || '').trim().split(/\s+/)
  switch (sub) {
    case 'stats': {
      const u = db.prepare('SELECT COUNT(*) n FROM users').get().n
      const cur = getCurrentIssue()
      const t = cur
        ? db
            .prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM orders WHERE status='paid' AND issue_no=?`)
            .get(cur.issue_no)
        : { n: 0, s: 0 }
      const q = db.prepare('SELECT COUNT(*) n FROM transfer_queue').get().n
      await ctx.reply(
        [
          `👥 绑定用户：${u}`,
          `🎫 当期（${cur?.issue_no ?? '-'}）订单：${t.n} 笔 / ${t.s} 萝卜`,
          `⏳ 待派队列：${q}`,
        ].join('\n')
      )
      return
    }
    case 'close': {
      const issue = getCurrentIssue()
      if (issue?.status === 'selling') {
        db.prepare(`UPDATE issues SET status='closed' WHERE issue_no=? AND status='selling'`).run(issue.issue_no)
        await ctx.reply(`第 ${issue.issue_no} 期已紧急停售`)
      }
      return
    }
    case 'draw': {
      const r = await runDraw(rest[0])
      if (r.ok && !r.already) await pushDrawResult(bot, r.issue).catch(() => {})
      await ctx.reply(`draw: ${JSON.stringify(r)}`)
      return
    }
    case 'resend': {
      const no = rest[0] ?? getCurrentIssue()?.issue_no
      const r = await pushDrawResult(bot, no)
      await ctx.reply(`resend: ${JSON.stringify(r)}`)
      return
    }
    default:
      await ctx.reply('用法：/admin stats | close | draw [期号] | resend [期号]')
  }
})

// ———— 启动 ————
if (config.PUBLIC_URL) {
  const { startWebServer } = await import('./server.js')
  await startWebServer((order, r) => {
    if (r.status === 'paid') {
      bot.api
        .sendMessage(order.tg_id, `✅ 支付已确认（web 回调），第 ${esc(order.issue_no)} 期 ×${order.bet_count} 注已生效。`)
        .catch(() => {})
    }
  })
} else {
  logger.info('PUBLIC_URL 未配置 → 纯轮询对账模式（deeplink + 5 分钟 reconcile）')
}

if (!getCurrentIssue()) openNewIssue()

await bot.init()
await bot.start({
  onStart: (me) => {
    logger.info({ bot: me.username }, 'EMOS 大乐透 bot 已启动 🎰')
    globalThis.__notifyAdmin?.('✅ Bot 已启动')
  },
})
