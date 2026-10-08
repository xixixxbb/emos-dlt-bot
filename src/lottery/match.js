import { GAME } from '../config/game.js'
import { parseNumbers } from './validate.js'

/**
 * 奖级匹配（计划书 §2.2 奖级表）
 * 返回 1..9 或 0（未中奖）
 *   1: 5+2  2: 5+1  3: 5+0
 *   4: 4+2  5: 4+1  6: 3+2  7: 4+0
 *   8: 3+1 | 2+2  9: 3+0 | 2+1 | 1+2 | 0+2
 */
export function matchLevel(betFront, betBack, drawFront, drawBack) {
  const f = hit(betFront, drawFront)
  const b = hit(betBack, drawBack)
  if (f === 5 && b === 2) return 1
  if (f === 5 && b === 1) return 2
  if (f === 5 && b === 0) return 3
  if (f === 4 && b === 2) return 4
  if (f === 4 && b === 1) return 5
  if (f === 3 && b === 2) return 6
  if (f === 4 && b === 0) return 7
  if ((f === 3 && b === 1) || (f === 2 && b === 2)) return 8
  if ((f === 3 && b === 0) || (f === 2 && b === 1) || (f === 1 && b === 2) || (f === 0 && b === 2)) return 9
  return 0
}

function hit(bet, draw) {
  const d = new Set(draw)
  return bet.filter((n) => d.has(n)).length
}

/** 存储字符串版（结算主入口） */
export function matchLevelStr(betFrontStr, betBackStr, drawFrontStr, drawBackStr) {
  return matchLevel(
    parseNumbers(betFrontStr),
    parseNumbers(betBackStr),
    parseNumbers(drawFrontStr),
    parseNumbers(drawBackStr)
  )
}

/** 奖级名称（推送/公示文案） */
export const LEVEL_NAMES = {
  1: '一等奖 5+2',
  2: '二等奖 5+1',
  3: '三等奖 5+0',
  4: '四等奖 4+2',
  5: '五等奖 4+1',
  6: '六等奖 3+2',
  7: '七等奖 4+0',
  8: '八等奖 3+1 / 2+2',
  9: '九等奖 3+0 / 2+1 / 1+2 / 0+2',
}

/** 结算视图：按注匹配并汇总各级注数（结算时一次性调用） */
export function matchAll(betsRows, drawFrontStr, drawBackStr) {
  const perBet = []
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 }
  for (const row of betsRows) {
    const level = matchLevelStr(row.front, row.back, drawFrontStr, drawBackStr)
    if (level > 0) {
      perBet.push({ betId: row.id, tgId: row.tg_id, level })
      counts[level]++
    }
  }
  return { perBet, counts }
}
