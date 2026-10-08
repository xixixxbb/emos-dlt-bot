import { config } from '../config/index.js'
import { emosRequest } from './client.js'

/**
 * 绑定校验（计划书 §5.2）：
 * 用回跳带来的【用户 token】调 GET /api/sign/check
 * → {is_sign: true, user_id: "eWD3N7EX8s"}
 * 注意：这里用用户 token，不是服务商 token
 */
export async function signCheck(userToken) {
  return emosRequest('GET', '/api/sign/check', { token: userToken })
}

/**
 * 生成 emos 授权链接（文档 link.md）
 * https://t.me/emospg_bot?start=link_<自己的用户ID>-<机器人的name>
 * 用户同意后回跳：t.me/<bot>?start=emosLinkAgree-<用户token>
 */
export function buildAuthLink(tgId) {
  return `https://t.me/emospg_bot?start=link_${tgId}-${config.BOT_NAME}`
}
