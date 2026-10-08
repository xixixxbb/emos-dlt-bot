import pRetry from 'p-retry'
import { config } from '../config/index.js'
import { logger } from '../util/index.js'

/**
 * emos API 统一封装（计划书 §5.1）
 * - Authorization: Bearer <token>
 * - 错误统一解析 {"message": "..."}（2026-06-21 changelog）
 * - 429/5xx 指数退避重试；422/4xx 不重试直接抛业务错误
 */
export class EmosApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.name = 'EmosApiError'
    this.status = status
    this.body = body
  }
}

async function request(method, path, { token, params, body, timeoutMs = 15000 } = {}) {
  const url = new URL(path, config.EMOS_BASE_URL)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })

  let json = null
  try {
    json = await res.json()
  } catch {
    /* 非 JSON 响应（如 CF 拦截页） */
  }

  if (!res.ok) {
    const message = json?.message || `HTTP ${res.status}`
    // 401 → token 失效（需人工重置），单独标识便于告警
    if (res.status === 401) {
      logger.error({ status: 401, path }, 'emos token 失效!')
    }
    throw new EmosApiError(message, res.status, json)
  }
  return json
}

/** 可重试请求：仅对网络错误 / 429 / 5xx 重试（p-retry 3 次） */
export async function emosRequest(method, path, opts = {}) {
  return pRetry(
    async () => {
      try {
        return await request(method, path, opts)
      } catch (e) {
        if (e instanceof EmosApiError && (e.status === 429 || e.status >= 500)) throw e // 触发重试
        throw new pRetry.AbortError(e) // 4xx 业务错误：不重试
      }
    },
    { retries: 3, factor: 2, minTimeout: 1000, maxTimeout: 8000 }
  )
}

/** 判定是否 token 失效错误 */
export function isAuthError(e) {
  return e instanceof EmosApiError && e.status === 401
}
