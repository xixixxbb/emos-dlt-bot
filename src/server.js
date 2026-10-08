import Fastify from 'fastify'
import { confirmOrderFromEmos } from './lottery/order.js'
import { logger, esc } from './util/index.js'
import { db } from './db/index.js'
import { config } from './config/index.js'

/**
 * Web 回调 + 健康检查（计划书 §7.5 / §9.5）
 * POST /emos/notify   emos 支付回调（web 主通道）
 * GET  /healthz       健康检查
 *
 * 安全：回调只认已存在的订单号，且入账仍以 pay/query 二次确认为准，
 *       payload 本身不作为支付依据（防伪造）。
 */
export async function startWebServer(notifyChannel = null) {
  const app = Fastify({ logger: false })

  app.post('/emos/notify', async (req, reply) => {
    const { no, time_payed, price_settle, param, notify_number } = req.body ?? {}
    if (!no || typeof no !== 'string') {
      return reply.code(400).send({ message: 'missing no' })
    }
    const order = db.prepare('SELECT * FROM orders WHERE no=?').get(no)
    if (!order) {
      // 未知订单：仍返回 200 避免无意义重试，记录日志审计
      logger.warn({ no, param }, '回调携带未知订单号（审计）')
      return reply.code(200).send({ message: 'ignored' })
    }
    if (order.param && param && order.param !== param) {
      logger.warn({ no, got: param, want: order.param }, '回调 param 不匹配（审计）')
      return reply.code(200).send({ message: 'ignored' })
    }
    try {
      const r = await confirmOrderFromEmos(no, 'webhook')
      if (notifyChannel) notifyChannel(order, r)
    } catch (e) {
      logger.error({ no, err: e.message }, '回调处理异常')
      // 返回 500 触发 emos 侧 1/2/3/4/5 分钟重试
      return reply.code(500).send({ message: 'retry later' })
    }
    return reply.code(200).send({ message: 'ok' })
  })

  app.get('/healthz', async () => {
    const now = db.prepare(`SELECT datetime('now') t`).get()
    const lastDraw = db
      .prepare(`SELECT issue_no, status FROM issues WHERE status='settled' ORDER BY issue_no DESC LIMIT 1`)
      .get()
    return {
      ok: true,
      db: !!now,
      lastSettledIssue: lastDraw?.issue_no ?? null,
      lastSettledStatus: lastDraw?.status ?? null,
      uptime: Math.floor(process.uptime()),
    }
  })

  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  logger.info({ port: config.PORT }, 'web server started')
  return app
}
