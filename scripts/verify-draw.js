#!/usr/bin/env node
/**
 * 开奖验证脚本（计划书 §6.2）
 * 任何人都可用公布的 seed + issue_no 复算开奖号码，与库中号码比对
 * 运行：
 *   本机：node scripts/verify-draw.js <issue_no>
 *   外部：node scripts/verify-draw.js <issue_no> <seed_hex>
 */
import { createHash } from 'node:crypto'
import { deriveNumbers } from '../src/lottery/fair.js'
import { pad2 } from '../src/lottery/validate.js'

const issueNo = process.argv[2]
if (!issueNo) {
  console.error('用法: node scripts/verify-draw.js <issue_no> [seed_hex]')
  process.exit(1)
}
let seed = process.argv[3]

// 未提供 seed 时从本地库读取（部署机上）；外部验证者应输入公布过的 seed
if (!seed) {
  try {
    const { db } = await import('../src/db/index.js')
    const issue = db.prepare('SELECT seed, draw_front, draw_back FROM issues WHERE issue_no=?').get(issueNo)
    if (!issue) throw new Error('issue not found')
    seed = issue.seed
  } catch (e) {
    console.error('无法从本地库读取 seed（外部验证请手动传入）：', e.message)
    process.exit(1)
  }
}

// 1. 号码复算
const { front, back } = deriveNumbers(seed, issueNo)
const drawFront = front.map(pad2).join(',')
const drawBack = back.map(pad2).join(',')

// 2. 哈希校验（与开售公布的 seed_hash 比对）
const seedHash = createHash('sha256').update(seed).digest('hex')

console.log('========== 开奖验证 ==========')
console.log(`期号: ${issueNo}`)
console.log(`种子: ${seed}`)
console.log(`种子哈希(SHA-256): ${seedHash}`)
console.log(`复算前区: ${drawFront}`)
console.log(`复算后区: ${drawBack}`)

// 3. 与库中号码比对（本地库存在时）
try {
  const { db } = await import('../src/db/index.js')
  const issue = db.prepare('SELECT seed_hash, draw_front, draw_back FROM issues WHERE issue_no=?').get(issueNo)
  if (issue) {
    console.log('--------- 与库中比对 ---------')
    console.log(`哈希一致: ${issue.seed_hash === seedHash ? '✓' : '✗'}  (库中 ${issue.seed_hash})`)
    console.log(`前区一致: ${issue.draw_front === drawFront ? '✓' : `✗ (库中 ${issue.draw_front})`}`)
    console.log(`后区一致: ${issue.draw_back === drawBack ? '✓' : `✗ (库中 ${issue.draw_back})`}`)
  }
} catch {
  /* 无本地库（外部验证） */
}
console.log('==============================')
