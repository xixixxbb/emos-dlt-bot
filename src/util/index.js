import pino from 'pino'

// 本模块保持零业务依赖（不 import config），供纯函数测试/模拟复用

export const logger = pino({ level: process.env.LOG_LEVEL || 'info' })

const DEFAULT_TZ = 'Asia/Shanghai'

/** 当前 UTC 时间（SQLite 格式 YYYY-MM-DD HH:MM:SS） */
export function utc(d = new Date()) {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

/** 指定时区日期 YYYY-MM-DD */
export function dateInTz(d = new Date(), tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
}

/** 指定时区的某日某时刻 → UTC Date */
export function zonedToUtc(dateStr, hhmm, tz = DEFAULT_TZ) {
  const naive = new Date(`${dateStr}T${hhmm}:00Z`)
  const off1 = tzOffsetMs(naive, tz)
  const guess = new Date(naive.getTime() - off1)
  const off2 = tzOffsetMs(guess, tz)
  return off1 === off2 ? guess : new Date(naive.getTime() - off2)
}

function tzOffsetMs(date, tz) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
    const part = dtf.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
    const m = part.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/)
    if (!m) return 0
    const h = parseInt(m[1], 10)
    const min = m[2] ? parseInt(m[2], 10) : 0
    return (h >= 0 ? h * 60 + min : h * 60 - min) * 60_000
  } catch {
    return 0
  }
}

/** UTC 存储字符串 → 业务时区显示 */
export function fmtTz(sqlUtcStr, tz = DEFAULT_TZ) {
  if (!sqlUtcStr) return '-'
  const d = new Date(sqlUtcStr.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return sqlUtcStr
  return new Intl.DateTimeFormat('zh-CN', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

export const pad2 = (n) => String(n).padStart(2, '0')

/** Telegram HTML 转义 */
export function esc(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** 大额派奖拆分（emos transfer 单次 ≤ 50000） */
export function splitCarrot(amount, limit = 50000) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return []
  const parts = []
  let rest = amount
  while (rest > limit) {
    parts.push(limit)
    rest -= limit
  }
  parts.push(rest)
  return parts
}

/** 下一次重试时刻（指数退避：2^attempts 分钟后，上限 60 分钟） */
export function nextRetryAt(attempts) {
  const ms = Math.min(2 ** attempts, 60) * 60_000
  return utc(new Date(Date.now() + ms))
}
