import { db } from '../db/index.js'
import { buildAuthLink, signCheck, EMOS_TOKEN_RE, EMOS_ID_RE } from '../emos/sign.js'
import { esc, logger } from '../util/index.js'

/**
 * 账号绑定（计划书 §5.2 + 实测修正）
 *
 * 流程：
 *   1. 用户 /bind（或直接 /start）→ bot 生成授权链接（首个参数固定为开发者 ID）
 *   2. 用户点链接 → emos 侧点「同意」→ 回跳 t.me/<bot>?start=emosLinkAgree-<用户token>
 *   3. bot 用该 token 调 /api/sign/check → 拿到 user_id → 入库
 *
 * 备用：用户可直接粘贴 emos 主站密钥（形如 3945_Jxxxx），省去跳转。
 */

function getBoundUser(tgId) {
  return db.prepare('SELECT * FROM users WHERE tg_id=?').get(tgId)
}

const BIND_TITLE = '🔐 <b>绑定 EMOS 账号</b>'

/** /bind：已绑定则展示信息，未绑定则给出授权按钮 */
export async function bindStart(ctx) {
  const user = getBoundUser(ctx.from.id)
  if (user) {
    await ctx.reply(
      [
        '✅ 你已绑定 EMOS 账号',
        '',
        `EMOS 用户 ID：<code>${esc(user.emos_user_id)}</code>`,
        '',
        '如需换绑其他账号，请发送 /rebind。',
      ].join('\n'),
      { parse_mode: 'HTML' }
    )
    return
  }
  let link
  try {
    link = await buildAuthLink()
  } catch (e) {
    logger.error({ err: e.message }, '生成授权链接失败')
    await ctx.reply(`⚠️ 暂时无法生成授权链接：${esc(e.message)}\n请联系管理员。`)
    return
  }
  await ctx.reply(
    [
      BIND_TITLE,
      '',
      '投注与派奖使用 EMOS 萝卜结算，需先绑定：',
      '',
      '点击下方按钮 → 在 EMOS 页面点「同意」→ 会自动跳回本机器人完成绑定。',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: '🔗 前往 EMOS 授权', url: link }]] },
    }
  )
}

/** /rebind：解绑后重新引导 */
export async function rebindStart(ctx) {
  const user = getBoundUser(ctx.from.id)
  if (user) {
    db.prepare('DELETE FROM users WHERE tg_id=?').run(ctx.from.id)
    logger.info({ tgId: ctx.from.id, was: user.emos_user_id }, '用户解绑')
  }
  await bindStart(ctx)
}

/**
 * 处理未绑定用户发来的文本
 * - 形如密钥（3945_Jxxxx）→ 直接校验绑定
 * - 形如 emos 用户 ID → 提示不需要发送（链接可直接点击）
 * 返回 true 表示已处理
 */
export async function handleBindText(ctx, text) {
  const raw = String(text || '').trim()

  if (EMOS_TOKEN_RE.test(raw)) {
    const wait = await ctx.reply('⏳ 正在校验密钥…')
    try {
      const info = await signCheck(raw)
      if (!info?.is_sign || !info?.user_id) {
        await wait.editText('❌ 密钥校验失败，请确认是从 emos 主站复制的完整密钥。')
        return true
      }
      saveBinding(ctx, info.user_id, raw)
      await wait.editText(
        ['✅ <b>绑定成功！</b>', '', `EMOS 用户：<code>${esc(info.user_id)}</code>`, '', '发送 /bet 开始投注。'].join('\n'),
        { parse_mode: 'HTML' }
      )
    } catch (e) {
      await wait.editText(`❌ 校验失败：${esc(e.message)}`)
    }
    return true
  }

  if (EMOS_ID_RE.test(raw)) {
    await ctx.reply(
      '不需要发送用户 ID 🙂\n授权链接会由机器人自动生成，直接发送 /bind 点击按钮即可完成绑定。'
    )
    return true
  }

  return false
}

/** deeplink 回跳：emosLinkAgree-<token> / emosLinkRefuse-<TgId> */
export async function handleLinkPayload(ctx, payload) {
  if (payload.startsWith('emosLinkRefuse')) {
    await ctx.reply('❌ 绑定被拒绝。可发送 /bind 重新发起。')
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
    saveBinding(ctx, info.user_id, userToken)
    await wait.editText(
      [
        '✅ <b>绑定成功！</b>',
        '',
        `EMOS 用户：<code>${esc(info.user_id)}</code>`,
        '',
        '发送 /bet 开始投注，或 /issues 查看当期奖池。',
      ].join('\n'),
      { parse_mode: 'HTML' }
    )
  } catch (e) {
    await wait.editText(`❌ 校验失败：${esc(e.message)}。请稍后重试 /bind`)
  }
}

function saveBinding(ctx, emosUserId, token) {
  db.prepare(
    `INSERT INTO users (tg_id, emos_user_id, emos_token, username, bound_at)
     VALUES (?,?,?,?,datetime('now'))
     ON CONFLICT(tg_id) DO UPDATE SET
       emos_user_id=excluded.emos_user_id,
       emos_token=excluded.emos_token,
       username=excluded.username,
       bound_at=excluded.bound_at`
  ).run(ctx.from.id, emosUserId, token, ctx.from.username ?? null)
  logger.info({ tgId: ctx.from.id, emosUserId }, '绑定成功')
}
