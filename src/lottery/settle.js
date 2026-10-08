import { GAME } from '../config/game.js'
import { matchAll } from './match.js'

/**
 * 结算引擎（计划书 §7.3 / 附录 A）— 纯函数模块
 * （settleIssue 持久化在 settle-db.js，避免测试/模拟依赖 better-sqlite3）
 *
 * 奖池 = 上期滚存 + floor(销售额 × 返奖率)
 * 固定奖（4-9 级）先扣；浮动池 = 奖池 − 固定奖支出，按 75/15/10 分给一二三等奖
 * 无人中的浮动份额 + 均分截余 + 份额取整余数 → 滚存；固定奖爆池 → 按比例折算
 */

export function computeSettlement({ sales, rolloverIn, payoutRate, betsRows, drawFront, drawBack }) {
  const { perBet, counts } = matchAll(betsRows, drawFront, drawBack)
  const pool = rolloverIn + Math.floor(sales * payoutRate)

  // 1. 固定奖
  let fixedPaid = 0
  const fixedBreakdown = {}
  for (const level of GAME.FIXED_LEVELS) {
    const amount = counts[level] * GAME.FIXED_PRIZES[level]
    fixedBreakdown[level] = amount
    fixedPaid += amount
  }

  const result = {
    perBet, counts, pool, rolloverIn, sales,
    fixedPaid, fixedBreakdown,
    floatPool: 0,
    floatAlloc: {},
    floatRollover: 0,
    rolloverOut: 0,
    payouts: [], // {betId, tgId, level, amount}
    overflow: false, // 爆池标记
  }

  // 2. 爆池保护：固定奖超奖池 → 按比例折算
  if (fixedPaid > pool) {
    result.overflow = true
    const ratio = pool / fixedPaid
    const scaled = {}
    let scaledTotal = 0
    for (const level of GAME.FIXED_LEVELS) {
      scaled[level] = Math.floor(fixedBreakdown[level] * ratio)
      scaledTotal += scaled[level]
    }
    result.fixedScaled = scaled
    for (const p of perBet) {
      const per = Math.floor(scaled[p.level] / counts[p.level])
      result.payouts.push({ ...p, amount: per })
    }
    result.rolloverOut = pool - scaledTotal // 折算截余滚存
    return result
  }

  // 3. 浮动奖（1-3 级）：75 / 15 / 10
  result.floatPool = pool - fixedPaid
  let floatRollover = 0
  let shareSum = 0
  for (const level of GAME.FLOAT_LEVELS) {
    const share = Math.floor(result.floatPool * GAME.FLOAT_SHARES[level])
    shareSum += share
    const n = counts[level]
    const alloc = { share, winners: n, perWinner: 0, rolled: 0 }
    if (n === 0) {
      alloc.rolled = share
    } else {
      alloc.perWinner = Math.floor(share / n)
      alloc.rolled = share - alloc.perWinner * n
      for (const p of perBet.filter((x) => x.level === level)) {
        result.payouts.push({ ...p, amount: alloc.perWinner })
      }
    }
    floatRollover += alloc.rolled
    result.floatAlloc[level] = alloc
  }
  result.floatRollover = floatRollover
  // 份额取整余数（三份 floor 之和 < 浮动池的零头）同样滚存，保证无人中奖时全额滚存
  result.remainder = result.floatPool - shareSum

  // 4. 固定奖 payout 明细
  for (const p of perBet) {
    if (GAME.FIXED_LEVELS.includes(p.level)) {
      result.payouts.push({ ...p, amount: GAME.FIXED_PRIZES[p.level] })
    }
  }

  result.rolloverOut = floatRollover + result.remainder
  return result
}

/** 按用户聚合派奖（减少 transfer 次数） */
export function aggregatePayouts(payouts) {
  const map = new Map()
  for (const p of payouts) {
    map.set(p.tgId, (map.get(p.tgId) || 0) + p.amount)
  }
  return [...map].map(([tgId, amount]) => ({ tgId, amount }))
}
