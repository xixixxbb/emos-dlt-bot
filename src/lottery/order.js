import * as nodeCrypto from 'node:crypto'
import { db } from '../db/index.js'
import { logger, utc } from '../util/index.js'
import { GAME } from '../config/game.js'
import { queryOrder, isOrderPaid, createOrder as emosCreateOrder } from '../emos/pay.js'
import { addSales } from './issue.js'

/**
 * 订单服务（计划书 §5.3 幂等与对账）
 * 三通道汇聚 confirmOrderPaid：deeplink / webhook / reconcile
 * 唯一入账依据：emos pay/query 返回已支付
 */

function newParam() {
  return nodeCrypto
    .randomBytes(6)
    .toString('base64url')
    .replace(/[-_]/g, '')
    .slice(0, 8)
    .toUpperCase()
}

/** 本地创建订单 + 投注明细（事务，未提交 emos） */
export function createBetOrder({ tgId, issueNo, bets, amount }) {
  const param = newParam()
  const expiresAt = utc(new Date(Date.now() + GAME.ORDER_TTL_MIN * 60_000))
  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO orders (no, tg_id, issue_no, amount, bet_count, param, status, pay_url, expires_at)
         VALUES ('',?,?,?,?,?, 'created', '', ?)`
      )
      .run(tgId, issueNo, amount, bets.length, param, expiresAt)
    const insBet = db.prepare(
      `INSERT INTO bets (order_id, tg_id, issue_no, front, back, is_quickpick) VALUES (?,?,?,?,?,?)`
    )
    for (const b of bets) {
      insBet.run(info.lastInsertRowid, tgId, issueNo, b.front, b.back, b.quickpick ? 1 : 0)
    }
    return { orderId: info.lastInsertRowid, param }
  })
  return create()
}

/** 调 emos 创建支付单并回填 no/pay_url（幂等：已有 no 直接返回） */
export async function submitOrderToEmos(orderId) {
  let order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId)
  if (!order) throw new Error('order not found')
  if (order.no) return order
  const resp = await emosCreateOrder({
    tgId: order.tg_id,
    price: order.amount,
    name: `大乐透 第${order.issue_no}期 ×${order.bet_count}注`,
    param: order.param,
  })
  const expires = resp.expired ? String(resp.expired).replace('T', ' ').slice(0, 19) : order.expires_at
  db.prepare(`UPDATE orders SET no=?, pay_url=?, expires_at=? WHERE id=?`).run(
    resp.no, resp.pay_url, expires, orderId
  )
  return db.prepare('SELECT * FROM orders WHERE id=?').get(orderId)
}

/** 用户有效未支付订单（防重复支付提示用） */
export function getPendingOrder(tgId, issueNo) {
  return db
    .prepare(
      `SELECT * FROM orders WHERE tg_id=? AND issue_no=? AND status='created' AND expires_at > datetime('now') LIMIT 1`
    )
    .get(tgId, issueNo)
}

/** 本期该用户有效注数（含未支付订单，保守计数） */
export function countUserBets(tgId, issueNo) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(bet_count),0) n FROM orders
       WHERE tg_id=? AND issue_no=? AND status IN ('created','paid')`
    )
    .get(tgId, issueNo)
  return row.n
}

/**
 * 入账核心（事务 + 幂等，需调用方先完成 pay/query）
 * @param queryResp pay/query 的响应（isOrderPaid 已判定为 true）
 */
export function confirmOrderPaid(no, channel, queryResp) {
  const order = db.prepare('SELECT * FROM orders WHERE no=?').get(no)
  if (!order) return { status: 'not_found' }
  if (order.status === 'paid') return { status: 'already', order }

  const issue = db.prepare('SELECT * FROM issues WHERE issue_no=?').get(order.issue_no)
  const late = !!issue && !['selling', 'closed'].includes(issue.status)

  const tx = db.transaction(() => {
    const r = db
      .prepare(
        `UPDATE orders SET status='paid', paid_at=?, confirmed_at=?, notify_channel=? WHERE no=? AND status='created'`
      )
      .run(utc(), utc(), channel, no)
    if (r.changes === 0) return // 并发下已被处理
    if (late) {
      // 迟到支付（期已开奖）：标记退款并入队
      db.prepare(`UPDATE orders SET refunded=1 WHERE no=?`).run(no)
      db.prepare(
        `INSERT INTO transfer_queue (kind, ref_id, tg_id, amount, next_retry_at) VALUES ('refund', ?, ?, ?, ?)`
      ).run(order.id, order.tg_id, order.amount, utc())
    } else {
      addSales(order.issue_no, order.amount)
    }
  })
  tx()

  const final = db.prepare('SELECT * FROM orders WHERE no=?').get(no)
  return late ? { status: 'refunded', order: final } : { status: 'paid', order: final }
}

/**
 * 外部统一入口：先 query 再入账（deeplink / webhook 共用）
 */
export async function confirmOrderFromEmos(no, channel) {
  const resp = await queryOrder(no)
  if (!isOrderPaid(resp)) return { status: 'not_paid', queryResp: resp }
  return confirmOrderPaid(no, channel, resp)
}

/** 对账 job：扫描 created 且超宽限的订单（异步） */
export async function reconcileOrders() {
  const rows = db
    .prepare(
      `SELECT * FROM orders WHERE status='created' AND no != ''
       AND expires_at <= datetime('now', '-' || ? || ' minutes')`
    )
    .all(GAME.RECONCILE_DELAY_MIN)
  let paidN = 0
  let refundN = 0
  let expiredN = 0
  for (const row of rows) {
    try {
      const resp = await queryOrder(row.no)
      if (isOrderPaid(resp)) {
        const r = confirmOrderPaid(row.no, 'reconcile', resp)
        if (r.status === 'refunded') refundN++
        else paidN++
      } else {
        const r = db
          .prepare(`UPDATE orders SET status='expired' WHERE no=? AND status='created'`)
          .run(row.no)
        if (r.changes > 0) expiredN++
      }
    } catch (e) {
      logger.warn({ no: row.no, err: e.message }, '对账单笔失败')
    }
  }
  const summary = { scanned: rows.length, paidN, refundN, expiredN }
  if (rows.length) logger.info(summary, '对账完成')
  return summary
}
