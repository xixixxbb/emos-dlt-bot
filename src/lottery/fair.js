import { createHash } from 'node:crypto'
import { GAME } from '../config/game.js'

/**
 * commit-reveal 可验证公平（计划书 §6）
 * 开售：生成 seed（保密），公布 seed_hash
 * 开奖：公布 seed，任何人可用 scripts/verify-draw.js 复算号码
 *
 * 号码派生（拒绝采样保证均匀，无模偏差）：
 *   rngF = SHA-256(seed || "front" || issue_no)  → 前区 35 选 5
 *   rngB = SHA-256(seed || "back"  || issue_no)  → 后区 12 选 2
 */

/** 哈希流 RNG：按需产出 [0,1) 均匀随机数 */
export class HashRng {
  constructor(domain, issueNo, seed) {
    this.counter = 0
    this.buf = Buffer.alloc(0)
    this.domain = domain
    this.issueNo = issueNo
    this.seed = seed
  }

  _refill() {
    const input = Buffer.concat([
      Buffer.from(this.seed, 'hex'),
      Buffer.from(this.domain),
      Buffer.from(this.issueNo),
      Buffer.from([this.counter]),
    ])
    this.buf = createHash('sha256').update(input).digest()
    this.counter = (this.counter + 1) & 0xff
  }

  /** 返回 uint32（0 .. 2^32-1 均匀） */
  nextUint32() {
    if (this.buf.length < 4) this._refill()
    const v = this.buf.readUInt32BE(0)
    this.buf = this.buf.subarray(4)
    return v
  }

  /** 返回 [0, n) 均匀整数（拒绝采样去除模偏差） */
  nextInt(n) {
    const limit = Math.floor(0x100000000 / n) * n
    for (;;) {
      const v = this.nextUint32()
      if (v < limit) return v % n
    }
  }
}

/** 用指定 seed 派生开奖号码（verify-draw.js 与开奖流程共用，保证可复算） */
export function deriveNumbers(seedHex, issueNo) {
  const front = drawPick(new HashRng('front', issueNo, seedHex), GAME.FRONT_MAX, GAME.FRONT_PICK)
  const back = drawPick(new HashRng('back', issueNo, seedHex), GAME.BACK_MAX, GAME.BACK_PICK)
  return { front, back }
}

function drawPick(rng, max, k) {
  const pool = Array.from({ length: max }, (_, i) => i + 1)
  for (let i = 0; i < k; i++) {
    const j = i + rng.nextInt(max - i)
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, k).sort((a, b) => a - b)
}

/** 开售时公布文本（含验证说明） */
export function fairnessBlurb(seedHash) {
  return [
    `🔒 公平保障（commit-reveal）：`,
    `本期种子哈希（SHA-256）：\n<code>${seedHash}</code>`,
    `开奖后公布种子，可用 verify-draw 脚本复算号码。`,
  ].join('\n')
}
