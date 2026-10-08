import 'dotenv/config'
import { z } from 'zod'
import { GAME, DEFAULTS } from './game.js'

/** 环境变量 schema：缺关键配置直接拒绝启动（计划书 §3.2） */
const envSchema = z.object({
  BOT_TOKEN: z.string().min(20, 'BOT_TOKEN 未配置'),
  EMOS_BASE_URL: z.string().url().default('https://test.emos.best'),
  EMOS_TOKEN: z.string().min(5, 'EMOS_TOKEN 未配置'),
  // 授权链接里的接入方标识（开发者 emos 用户 ID）；留空则自动从服务商 token 推导
  EMOS_DEVELOPER_ID: z
    .string()
    .regex(/^$|^e[A-Za-z0-9]{8}s$/, 'EMOS_DEVELOPER_ID 应为 e 开头 s 结尾的 10 位 emos 用户 ID，或留空')
    .default(''),
  BOT_NAME: z.string().regex(/^[A-Za-z0-9_]{3,64}$/, 'BOT_NAME 应为不含 @ 的机器人用户名'),
  ADMIN_TG_ID: z.coerce.number().int().positive('ADMIN_TG_ID 未配置'),
  DB_PATH: z.string().default('./data/dlt.db'),
  PORT: z.coerce.number().int().default(8787),
  PUBLIC_URL: z.string().default(''),
  SELL_CRON: z.string().default('1 0 0 * * *'),
  CLOSE_CRON: z.string().default('30 20 * * *'),
  DRAW_CRON: z.string().default('0 0 21 * * *'),
  SALE_CLOSE_TIME: z.string().regex(/^\d{2}:\d{2}$/).default('20:30'),
  DRAW_TIME: z.string().regex(/^\d{2}:\d{2}$/).default('21:00'),
  TZ: z.string().default('Asia/Shanghai'),
  PRICE_PER_BET: z.coerce.number().int().min(1).default(DEFAULTS.PRICE_PER_BET),
  PAYOUT_RATE: z.coerce.number().min(0.5).max(1).default(DEFAULTS.PAYOUT_RATE),
  MAX_BETS_PER_USER: z.coerce.number().int().min(1).default(DEFAULTS.MAX_BETS_PER_USER),
  CHANNEL_ID: z.string().default(''),
  NODE_ENV: z.enum(['production', 'development']).default('production'),
  LOG_PRETTY: z.string().default(''),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ 环境变量校验失败：')
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  process.exit(1)
}

export const config = parsed.data

// 计划书 §0 待确认事项 1：PAYOUT_RATE + 运营留存必须 ≤ 1
if (config.PAYOUT_RATE >= 1) {
  console.error('❌ PAYOUT_RATE 必须 < 1（返奖 + 运营留存不得超过 100%）')
  process.exit(1)
}

export { GAME }
