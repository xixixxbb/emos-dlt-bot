#!/usr/bin/env node
/**
 * 蒙特卡洛返奖率校准（计划书 §2.3 / §10）
 * npm run simulate -- --issues=10000 --bets=500 [--rate=0.95]
 */
import { GAME, DEFAULTS } from '../src/config/game.js'
import { computeSettlement } from '../src/lottery/settle.js'
import { deriveNumbers } from '../src/lottery/fair.js'
import { quickPick, fmtNumbers } from '../src/lottery/validate.js'
import { createHash, randomBytes } from 'node:crypto'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')))
const N_ISSUES = Number(args.issues || 10000)
const N_BETS = Number(args.bets || 500)
const PAYOUT_RATE = Number(args.rate || DEFAULTS.PAYOUT_RATE)

let totalSales = 0
let totalPaid = 0
let rollover = 0
let jackpotIssues = 0
let overflowIssues = 0
const levelIssues = { 1: 0, 2: 0, 3: 0 }

for (let i = 0; i < N_ISSUES; i++) {
  const issueNo = String(i)
  const seed = randomBytes(32).toString('hex')
  const { front, back } = deriveNumbers(seed, issueNo)
  const drawFront = fmtNumbers(front)
  const drawBack = fmtNumbers(back)

  const betsRows = Array.from({ length: N_BETS }, (_, j) => {
    const p = quickPick()
    return { id: j, tg_id: j, front: fmtNumbers(p.front), back: fmtNumbers(p.back) }
  })

  const sales = N_BETS * DEFAULTS.PRICE_PER_BET
  const r = computeSettlement({ sales, rolloverIn: rollover, payoutRate: PAYOUT_RATE, betsRows, drawFront, drawBack })

  totalSales += sales
  totalPaid += r.payouts.reduce((a, p) => a + p.amount, 0)
  rollover = r.rolloverOut
  if (r.counts[1] > 0) levelIssues[1]++
  if (r.counts[2] > 0) levelIssues[2]++
  if (r.counts[3] > 0) levelIssues[3]++
  if (r.overflow) overflowIssues++
}

const rate = totalPaid / totalSales
console.log('========== 蒙特卡洛校准报告 ==========')
console.log(`期数: ${N_ISSUES} × ${N_BETS} 注/期（注价 ${DEFAULTS.PRICE_PER_BET}）`)
console.log(`总销售额: ${totalSales.toLocaleString()} 萝卜`)
console.log(`总派奖: ${totalPaid.toLocaleString()} 萝卜`)
console.log(`实际返奖率: ${(rate * 100).toFixed(3)}%  （目标 ${(PAYOUT_RATE * 100).toFixed(1)}%）`)
console.log(`期末滚存: ${rollover.toLocaleString()} 萝卜`)
console.log(`出现一等奖期数: ${levelIssues[1]} · 二等奖: ${levelIssues[2]} · 三等奖: ${levelIssues[3]}`)
console.log(`爆池（固定奖超支折算）期数: ${overflowIssues}`)
console.log('======================================')
