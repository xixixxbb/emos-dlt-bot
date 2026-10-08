import { randomBytes } from 'node:crypto'
import { GAME } from '../config/game.js'

/**
 * 选号校验与注数计算（计划书 §7.2）
 * 支持格式："01 05 12 23 34 + 03 09" / "1,5,12,23,34+3,9"（空格/逗号/、分隔，+ 号分隔前后区）
 */

function parseNum(tok, max) {
  const n = Number.parseInt(tok, 10)
  if (!Number.isInteger(n) || n < 1 || n > max) return null
  return n
}

function dedupeSorted(nums) {
  return [...new Set(nums)].sort((a, b) => a - b)
}

/** 解析用户选号（复式输入） */
export function parseSelection(input) {
  const text = String(input || '').trim().replace(/[，、]/g, ' ')
  if (!text) return { ok: false, error: '输入为空' }
  const parts = text.split('+')
  if (parts.length !== 2) return { ok: false, error: '格式错误：需要用 + 分隔前区与后区' }
  const frontTokens = parts[0].trim().split(/[\s,]+/).filter(Boolean)
  const backTokens = parts[1].trim().split(/[\s,]+/).filter(Boolean)
  if (frontTokens.length !== new Set(frontTokens).size || backTokens.length !== new Set(backTokens).size) {
    return { ok: false, error: '存在重复号码' }
  }
  const front = frontTokens.map((t) => parseNum(t, GAME.FRONT_MAX))
  const back = backTokens.map((t) => parseNum(t, GAME.BACK_MAX))
  if (front.some((n) => n === null)) return { ok: false, error: `前区号码需为 1-${GAME.FRONT_MAX}` }
  if (back.some((n) => n === null)) return { ok: false, error: `后区号码需为 1-${GAME.BACK_MAX}` }

  const f = dedupeSorted(front)
  const b = dedupeSorted(back)
  if (f.length < GAME.FRONT_PICK || f.length > GAME.FRONT_MAX_CHOOSE) {
    return { ok: false, error: `前区需选 ${GAME.FRONT_PICK}-${GAME.FRONT_MAX_CHOOSE} 个` }
  }
  if (b.length < GAME.BACK_PICK || b.length > GAME.BACK_MAX_CHOOSE) {
    return { ok: false, error: `后区需选 ${GAME.BACK_PICK}-${GAME.BACK_MAX_CHOOSE} 个` }
  }
  return { ok: true, front: f, back: b }
}

/** 组合数 C(n, k) */
export function comb(n, k) {
  if (k < 0 || n < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

/** 复式注数 = C(前区数,5) × C(后区数,2) */
export function betCount(front, back) {
  return comb(front.length, GAME.FRONT_PICK) * comb(back.length, GAME.BACK_PICK)
}

/** 复式 → 单式全展开 */
export function expand(front, back) {
  const fronts = combinations(front, GAME.FRONT_PICK)
  const backs = combinations(back, GAME.BACK_PICK)
  const list = []
  for (const f of fronts) for (const b of backs) list.push({ front: f, back: b })
  return list
}

function combinations(arr, k) {
  const res = []
  const cur = []
  ;(function rec(start) {
    if (cur.length === k) {
      res.push([...cur])
      return
    }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i])
      rec(i + 1)
      cur.pop()
    }
  })(0)
  return res
}

export const pad2 = (n) => String(n).padStart(2, '0')

/** 号码数组 → 存储字符串（升序） */
export const fmtNumbers = (nums) => dedupeSorted(nums).map(pad2).join(',')

/** 存储字符串 → 数组 */
export const parseNumbers = (s) => String(s || '').split(',').filter(Boolean).map(Number)

/** 机选一注（crypto 随机） */
export function quickPick() {
  return {
    front: pickUniform(GAME.FRONT_MAX, GAME.FRONT_PICK),
    back: pickUniform(GAME.BACK_MAX, GAME.BACK_PICK),
  }
}

function rngUnit() {
  return randomBytes(4).readUInt32BE(0) / 0x1_0000_0000
}

/** Fisher-Yates 均匀抽取 k 个（1..max） */
function pickUniform(max, k) {
  const pool = Array.from({ length: max }, (_, i) => i + 1)
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rngUnit() * (max - i))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, k).sort((a, b) => a - b)
}
