import { randomBytes } from 'node:crypto'
import { config } from '../config/index.js'
import { emosRequest } from './client.js'
import { utc } from '../util/index.js'

/** 生成我方 param：8 位随机字母数字（回传标识，40 字符内） */
export function newParam() {
  return randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8).toUpperCase()
}

/**
 * 创建支付订单（计划书 §5.2）
 * POST /api/pay/create {pay_way:"telegram_bot", price, name, param, callback_telegram_bot_name}
 * 响应 {no, pay_way, pay_url, expired}
 */
export async function createOrder({ tgId, price, name, param }) {
  return emosRequest('POST', '/api/pay/create', {
    token: config.EMOS_TOKEN,
    body: {
      pay_way: 'telegram_bot',
      price,
      name: String(name).slice(0, 100),
      param: param ?? null,
      callback_telegram_bot_name: config.BOT_NAME,
    },
  })
}

/**
 * 查询订单（唯一入账依据）
 * GET /api/pay/query?no=xxx
 */
export async function queryOrder(no) {
  return emosRequest('GET', '/api/pay/query', {
    token: config.EMOS_TOKEN,
    params: { no },
  })
}

/** 判断订单是否已支付（兼容多种可能的字段写法，确认后收紧） */
export function isOrderPaid(queryResp) {
  if (!queryResp || typeof queryResp !== 'object') return false
  const s = String(
    queryResp.status ?? queryResp.order_status ?? queryResp.state ?? ''
  ).toLowerCase()
  if (['paid', 'success', 'payed', 'completed', 'finish'].includes(s)) return true
  if (queryResp.time_payed || queryResp.time_paid) return true
  return false
}

/**
 * 转账给用户（派奖/退款）
 * POST /api/pay/transfer {user_id, carrot}  费率千 6
 * 返回 {deduct, carrot}
 */
export async function transferToUser(emosUserId, carrot) {
  return emosRequest('POST', '/api/pay/transfer', {
    token: config.EMOS_TOKEN,
    body: { user_id: emosUserId, carrot },
  })
}

/** 关闭订单 GET /api/pay/close?no= */
export async function closeOrder(no) {
  return emosRequest('GET', '/api/pay/close', {
    token: config.EMOS_TOKEN,
    params: { no },
  })
}

/** 查用户（可按 tg id 查）GET /api/pay/getUserInfo */
export async function getUserInfo({ userId, username, telegramUserId }) {
  return emosRequest('GET', '/api/pay/getUserInfo', {
    token: config.EMOS_TOKEN,
    params: { user_id: userId, username, telegram_user_id: telegramUserId },
  })
}

/** 查用户可用萝卜 GET /api/pay/getUserCarrot?user_id= */
export async function getUserCarrot(emosUserId) {
  return emosRequest('GET', '/api/pay/getUserCarrot', {
    token: config.EMOS_TOKEN,
    params: { user_id: emosUserId },
  })
}

/** 服务商信息 GET /api/pay/base */
export async function payBase() {
  return emosRequest('GET', '/api/pay/base', { token: config.EMOS_TOKEN })
}

export { utc }
