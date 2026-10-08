import { db } from '../db/index.js'
import { buildAuthLink } from '../../emos/sign.js'
import { signCheck } from '../../emos/sign.js'

/**
 * 用户绑定（计划书 §5.2）
 * /bind → t.me/emospg_bot?start=link_<tg_id>-<bot_name>
 * 回跳 /start emosLinkAgree-<userToken> → signCheck(token) → 入库
 */

export async function bindStart(ctx) {
  const link = buildAuthLink(ctx.from.id)
  await ctx.reply(
    [
      '🔐 <b>绑定 EMOS 账号</b>',
      '',
      '投注与派奖使用 EMOS 萝卜结算，需先完成绑定：',
      '',
      `👉 <a href="${link}">点击这里前往 EMOS 授权</a>`,
      '',
      '授权完成后会自动跳回本机器人，无需其他操作。',
    ].join('\n'),
    { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
  )
}

/** deeplink 回跳：emosLinkAgree-<token> / emosLinkRefuse-<TgId> */
export async function handleLinkPayload(ctx, payload) {
  if (payload.startsWith('emosLinkRefuse')) {
    await ctx.reply('❌ 绑定被拒绝。可随时发送 /bind 重新发起。')
    return
  }
  const m = payload.match(/^emosLinkAgree-(.+)$/)
  if (!m) return
  const userToken = m[1]
  const wait = await ctx.reply('⏳ 正在验证授权…')
  try {
    const info = await signCheck(userToken)
    if (!info?.is_sign || !info?.user_id) {
      await wait.editText('❌ 授权校验失败（token 无效），请重新 /bind')
      return
    }
    // 写库（upsert：token 可能被用户重置后重新绑定）
    db.prepare(
      `INSERT INTO users (tg_id, emos_user_id, emos_token, username, bound_at)
       VALUES (?,?,?,?,datetime('now'))
       ON CONFLICT(tg_id) DO UPDATE SET emos_user_id=excluded.emos_user_id, emos_token=excluded.emos_token, bound_at=datetime('now')`
    ).run(ctx.from.id, info.user_id, userToken, ctx.from.username ?? null)
    await wait.editText(
      [
        '✅ <b>绑定成功！</b>',
        '',
        `EMOS 用户：<code>${esc(info.user_id)}</code>`,
        '',
        '现在可以发送 /bet 开始投注，或 /issues 查看当期奖池。',
      ].join('\n'),
      { parse_mode: 'HTML' }
    )
  } catch (e) {
    await wait.editText(`❌ 校验失败：${esc(e.message)}。请稍后重试 /bind`)
  }
}

import { esc } from '../../util/index.js'
