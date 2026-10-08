import { config } from '../config/index.js'
import { emosRequest } from './client.js'
import { buildAuthLinkWith } from './id.js'

export { EMOS_ID_RE, EMOS_TOKEN_RE, extractEmosId } from './id.js'

/**
 * 绑定相关（计划书 §5.2 + 实测修正）
 *
 * 授权链接：https://t.me/emospg_bot?start=link_<ID>-<botName>
 *
 * 关于第一个参数 <ID>（实测确认）：
 *   - 它是 **接入方（bot 开发者）的 emos 用户 ID**，用于标识是哪个应用在接入，
 *     **没有实际功能作用**——不影响授权结果。
 *   - 既不是 Telegram ID，也不是正在绑定的用户自己的 ID。
 *   - 因此这里取「开发者 ID」：优先 .env 的 EMOS_DEVELOPER_ID，未配置时
 *     自动用服务商 token 调 /api/sign/check 推导（返回的 user_id 即该账号自己的 ID）。
 */

let cachedDeveloperId = null

/** 取接入方（开发者）emos 用户 ID（带缓存） */
export async function getDeveloperId() {
  if (config.EMOS_DEVELOPER_ID) return config.EMOS_DEVELOPER_ID
  if (cachedDeveloperId) return cachedDeveloperId
  const info = await signCheck(config.EMOS_TOKEN)
  if (!info?.is_sign || !info?.user_id) {
    throw new Error('无法用服务商 token 推导开发者 emos ID，请在 .env 配置 EMOS_DEVELOPER_ID')
  }
  cachedDeveloperId = info.user_id
  return cachedDeveloperId
}

/** 生成 emos 授权链接（首个参数为开发者 ID） */
export async function buildAuthLink() {
  return buildAuthLinkWith(await getDeveloperId(), config.BOT_NAME)
}

/**
 * 用【用户 token】调 GET /api/sign/check → {is_sign, user_id}
 * 注意：用用户 token，不是服务商 token
 */
export async function signCheck(userToken) {
  return emosRequest('GET', '/api/sign/check', { token: userToken })
}
