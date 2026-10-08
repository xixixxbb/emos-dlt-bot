/**
 * emos 标识符格式与解析（纯函数模块，无环境依赖，便于单测）
 *
 * 实测与文档要点：
 *   emos 用户 ID（pn）：e 开头、s 结尾、共 10 位，如 eR3YXL09Ls
 *   emos 用户 token   ：数字_字母数字，如 3945_Jxxxxxxxxxxx（主站「密钥」）
 *   ⚠️ Telegram ID（纯数字，如 7346917792）不是 emos 用户 ID，
 *      用它生成 link_ 授权链接会导致 emos 侧无法识别用户。
 */

/** emos 用户 ID：e + 8 位字母数字 + s */
export const EMOS_ID_RE = /^e[A-Za-z0-9]{8}s$/

/** emos 用户 token（主站密钥）：数字_字母数字 */
export const EMOS_TOKEN_RE = /^\d{1,6}_[A-Za-z0-9_-]{6,}$/

/**
 * 从纯 ID / 整段授权链接 / 任意文本中提取 emos 用户 ID
 * 提取不到返回 null（纯数字的 Telegram ID 会被正确拒绝）
 */
export function extractEmosId(text) {
  const s = String(text || '').trim()
  if (EMOS_ID_RE.test(s)) return s
  const fromLink = s.match(/link_([A-Za-z0-9]{6,16})-/)
  if (fromLink && EMOS_ID_RE.test(fromLink[1])) return fromLink[1]
  const anywhere = s.match(/\b(e[A-Za-z0-9]{8}s)\b/)
  return anywhere ? anywhere[1] : null
}

/** 拼接 emos 机器人授权链接（不依赖 config，便于测试） */
export function buildAuthLinkWith(emosUserId, botName) {
  return `https://t.me/emospg_bot?start=link_${emosUserId}-${botName}`
}
