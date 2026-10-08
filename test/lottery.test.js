import { describe, it, expect } from 'vitest'
import { GAME } from '../src/config/game.js'

import { matchLevel, matchAll } from '../src/lottery/match.js'

describe('奖级匹配（全 9 级）', () => {
  const F = [1, 5, 12, 23, 34]
  const dF = [1, 5, 12, 23, 34]
  const dB = [3, 9]

  it('各级命中正确', () => {
    expect(matchLevel(F, [3, 9], dF, dB)).toBe(1) // 5+2
    expect(matchLevel(F, [3, 1], dF, dB)).toBe(2) // 5+1
    expect(matchLevel(F, [1, 2], dF, dB)).toBe(3) // 5+0
    expect(matchLevel([1, 5, 12, 23, 33], [3, 9], dF, dB)).toBe(4) // 4+2
    expect(matchLevel([1, 5, 12, 23, 33], [3, 1], dF, dB)).toBe(5) // 4+1
    expect(matchLevel([1, 5, 12, 22, 33], [3, 9], dF, dB)).toBe(6) // 3+2
    expect(matchLevel([1, 5, 12, 23, 33], [1, 2], dF, dB)).toBe(7) // 4+0
    expect(matchLevel([1, 5, 12, 22, 33], [3, 1], dF, dB)).toBe(8) // 3+1
    expect(matchLevel([1, 5, 11, 22, 33], [3, 9], dF, dB)).toBe(8) // 2+2
    expect(matchLevel([1, 5, 12, 22, 33], [1, 2], dF, dB)).toBe(9) // 3+0
    expect(matchLevel([1, 5, 11, 22, 33], [3, 1], dF, dB)).toBe(9) // 2+1
    expect(matchLevel([1, 6, 11, 22, 33], [3, 9], dF, dB)).toBe(9) // 1+2
    expect(matchLevel([2, 6, 11, 22, 33], [3, 9], dF, dB)).toBe(9) // 0+2
    expect(matchLevel([2, 6, 11, 22, 33], [1, 2], dF, dB)).toBe(0) // 未中
  })

  it('matchAll 汇总', () => {
    const rows = [
      { id: 1, tg_id: 100, front: '01,05,12,23,34', back: '03,09' },
      { id: 2, tg_id: 200, front: '01,05,12,23,34', back: '01,02' },
      { id: 3, tg_id: 300, front: '02,06,11,22,33', back: '03,09' },
    ]
    const { perBet, counts } = matchAll(rows, '01,05,12,23,34', '03,09')
    expect(counts[1]).toBe(1)
    expect(counts[3]).toBe(1)
    expect(counts[9]).toBe(1)
    expect(perBet.map((p) => p.level).sort()).toEqual([1, 3, 9])
  })
})

import { parseSelection, betCount, expand, quickPick, comb, fmtNumbers } from '../src/lottery/validate.js'

describe('选号解析与注数', () => {
  it('标准单式', () => {
    const r = parseSelection('01 05 12 23 34 + 03 09')
    expect(r.ok).toBe(true)
    expect(r.front).toEqual([1, 5, 12, 23, 34])
    expect(r.back).toEqual([3, 9])
    expect(betCount(r.front, r.back)).toBe(1)
  })

  it('复式注数', () => {
    expect(comb(5, 2)).toBe(10)
    expect(betCount([1, 2, 3, 4, 5, 6], [3, 9])).toBe(6) // C(6,5)×C(2,2)
    expect(betCount([1, 2, 3, 4, 5, 6, 7], [3, 9, 11])).toBe(63) // C(7,5)×C(3,2)
    expect(betCount([1, 2, 3, 4, 5, 6, 7, 8], [3, 9, 11, 12])).toBe(336) // C(8,5)×C(4,2)
  })

  it('复式展开', () => {
    const r = parseSelection('01 02 03 04 05 06 + 03 09')
    expect(r.ok).toBe(true)
    expect(expand(r.front, r.back).length).toBe(6)
  })

  it('错误输入', () => {
    expect(parseSelection('01 02 03 + 04 05').ok).toBe(false)
    expect(parseSelection('01 02 03 04 05 06 07 08 09 + 01 02').ok).toBe(false)
    expect(parseSelection('01 01 03 04 05 + 01 02').ok).toBe(false)
    expect(parseSelection('01 02 03 04 36 + 01 02').ok).toBe(false)
    expect(parseSelection('01 02 03 04 05').ok).toBe(false)
  })

  it('机选号码合法且有序', () => {
    for (let i = 0; i < 100; i++) {
      const p = quickPick()
      expect(p.front.length).toBe(5)
      expect(p.back.length).toBe(2)
      expect(new Set(p.front).size).toBe(5)
      expect(p.front.every((n) => n >= 1 && n <= 35)).toBe(true)
      expect(p.back.every((n) => n >= 1 && n <= 12)).toBe(true)
      expect(fmtNumbers(p.front)).toMatch(/^\d{2},\d{2},\d{2},\d{2},\d{2}$/)
    }
  })
})

import { deriveNumbers, HashRng } from '../src/lottery/fair.js'
import { createHash } from 'node:crypto'

describe('commit-reveal 公平开奖', () => {
  it('确定性：同 seed 同期号 → 同号码', () => {
    const seed = 'ab'.repeat(32)
    const a = deriveNumbers(seed, '20261007')
    expect(deriveNumbers(seed, '20261007')).toEqual(a)
    expect(deriveNumbers(seed, '20261008')).not.toEqual(a)
  })

  it('号码范围合法', () => {
    for (let i = 0; i < 50; i++) {
      const seed = createHash('sha256').update(String(i)).digest('hex')
      const { front, back } = deriveNumbers(seed, '20261007')
      expect(front.length).toBe(5)
      expect(new Set(front).size).toBe(5)
      expect(front.every((n) => n >= 1 && n <= 35)).toBe(true)
      expect(back.every((n) => n >= 1 && n <= 12)).toBe(true)
    }
  })

  it('HashRng nextInt 边界', () => {
    const rng = new HashRng('test', '1', 'ff'.repeat(32))
    for (let i = 0; i < 200; i++) {
      const v = rng.nextInt(35)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(35)
    }
  })
})

import { computeSettlement, aggregatePayouts } from '../src/lottery/settle.js'

describe('结算引擎', () => {
  const D = { drawFront: '01,05,12,23,34', drawBack: '03,09' }

  it('无人中奖：浮动池全额滚存（含取整余数）', () => {
    const betsRows = [{ id: 1, tg_id: 100, front: '02,06,11,22,33', back: '01,02' }]
    const r = computeSettlement({ sales: 200, rolloverIn: 0, payoutRate: 0.95, betsRows, ...D })
    expect(r.pool).toBe(190)
    expect(r.fixedPaid).toBe(0)
    expect(r.floatPool).toBe(190)
    expect(r.payouts.length).toBe(0)
    expect(r.rolloverOut).toBe(190) // 142+28+19=189，余数 1 也滚存
  })

  it('一等奖单人独中：其余浮动份额滚存', () => {
    const betsRows = [
      { id: 1, tg_id: 100, front: '01,05,12,23,34', back: '03,09' },
      { id: 2, tg_id: 200, front: '02,06,11,22,33', back: '01,02' },
    ]
    const r = computeSettlement({ sales: 400, rolloverIn: 0, payoutRate: 0.95, betsRows, ...D })
    expect(r.counts[1]).toBe(1)
    expect(r.payouts.find((p) => p.level === 1).amount).toBe(285)
    expect(r.rolloverOut).toBe(95) // 二等 57 + 三等 38
  })

  it('固定奖四等奖', () => {
    const betsRows = [{ id: 1, tg_id: 100, front: '01,05,12,23,33', back: '03,09' }]
    const r = computeSettlement({ sales: 1000, rolloverIn: 0, payoutRate: 0.95, betsRows, ...D })
    expect(r.fixedPaid).toBe(800)
    expect(r.payouts.find((x) => x.level === 4).amount).toBe(800)
  })

  it('爆池保护：固定奖超奖池按比例折算', () => {
    const betsRows = [{ id: 1, tg_id: 100, front: '01,05,12,23,33', back: '03,09' }]
    const r = computeSettlement({ sales: 2, rolloverIn: 0, payoutRate: 0.95, betsRows, ...D })
    expect(r.pool).toBe(1)
    expect(r.overflow).toBe(true)
    expect(r.fixedScaled[4]).toBe(1)
    expect(r.payouts[0].amount).toBe(1)
  })

  it('按用户聚合', () => {
    expect(
      aggregatePayouts([
        { betId: 1, tgId: 100, level: 9, amount: 10 },
        { betId: 2, tgId: 100, level: 8, amount: 20 },
        { betId: 3, tgId: 200, level: 9, amount: 10 },
      ])
    ).toEqual([
      { tgId: 100, amount: 30 },
      { tgId: 200, amount: 10 },
    ])
  })

  it('滚存滚入下期', () => {
    const r = computeSettlement({ sales: 0, rolloverIn: 500, payoutRate: 0.95, betsRows: [], ...D })
    expect(r.pool).toBe(500)
    expect(r.rolloverOut).toBe(500)
  })
})

import { splitCarrot, nextRetryAt } from '../src/util/index.js'

describe('util', () => {
  it('大额拆分', () => {
    expect(splitCarrot(120000)).toEqual([50000, 50000, 20000])
    expect(splitCarrot(50000)).toEqual([50000])
    expect(splitCarrot(1)).toEqual([1])
    expect(splitCarrot(0)).toEqual([])
  })
  it('重试时间格式', () => {
    expect(nextRetryAt(1)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})

import { parseDeeplink } from '../src/bot/deeplink.js'

describe('deeplink 解析（含订单号带 - 场景）', () => {
  it('支付成功（空 param，订单号含 -）', () => {
    const d = parseDeeplink('emosPayAgree-20260215153614-pay-eA2rq--8129903593')
    expect(d.type).toBe('pay_agree')
    expect(d.no).toBe('20260215153614-pay-eA2rq')
    expect(d.param).toBe('')
    expect(d.tgid).toBe('8129903593')
  })
  it('支付成功（带 param）', () => {
    const d = parseDeeplink('emosPayAgree-20260209112233payEMOS-AABB-8129903593')
    expect(d.no).toBe('20260209112233payEMOS')
    expect(d.param).toBe('AABB')
  })
  it('支付失败', () => {
    const d = parseDeeplink('emosPayRefuse-20260215153614-pay-eA2rq--8129903593')
    expect(d.type).toBe('pay_refuse')
    expect(d.no).toBe('20260215153614-pay-eA2rq')
  })
  it('绑定', () => {
    expect(parseDeeplink('emosLinkAgree-11_AkJO2UdOKinqmKOU').type).toBe('link_agree')
    expect(parseDeeplink('emosLinkAgree-11_AkJO2UdOKinqmKOU').token).toBe('11_AkJO2UdOKinqmKOU')
    expect(parseDeeplink('emosLinkRefuse-8129903593').type).toBe('link_refuse')
  })
  it('无关 payload', () => {
    expect(parseDeeplink('hello')).toBeNull()
  })
})

// ———— emos 标识符与授权链接（实测修正：必须用 emos 用户 ID，不是 Telegram ID）————
import { EMOS_ID_RE, EMOS_TOKEN_RE, extractEmosId, buildAuthLinkWith } from '../src/emos/id.js'

describe('emos 标识符与授权链接', () => {
  it('emos 用户 ID 格式（e 开头 s 结尾共 10 位）', () => {
    expect(EMOS_ID_RE.test('eR3YXL09Ls')).toBe(true)
    expect(EMOS_ID_RE.test('eW3GMWD3Js')).toBe(true)
    expect(EMOS_ID_RE.test('7346917792')).toBe(false) // Telegram ID 不是 emos ID
    expect(EMOS_ID_RE.test('eR3YXL09L')).toBe(false) // 缺结尾 s
    expect(EMOS_ID_RE.test('eR3YXL09Lss')).toBe(false) // 过长
  })

  it('从各种输入中提取 emos ID', () => {
    expect(extractEmosId('eR3YXL09Ls')).toBe('eR3YXL09Ls')
    expect(extractEmosId('https://t.me/emospg_bot?start=link_eR3YXL09Ls-emos_dlt_bot')).toBe('eR3YXL09Ls')
    expect(extractEmosId('我的 ID 是 eR3YXL09Ls')).toBe('eR3YXL09Ls')
    expect(extractEmosId('7346917792')).toBeNull()
    expect(extractEmosId('随便说点什么')).toBeNull()
  })

  it('授权链接与文档示例格式一致', () => {
    expect(buildAuthLinkWith('eR3YXL09Ls', 'emos_dlt_bot')).toBe(
      'https://t.me/emospg_bot?start=link_eR3YXL09Ls-emos_dlt_bot'
    )
  })

  it('用户密钥格式', () => {
    expect(EMOS_TOKEN_RE.test('3945_Jxxxxxxxxx')).toBe(true)
    expect(EMOS_TOKEN_RE.test('11_test-token')).toBe(true)
    expect(EMOS_TOKEN_RE.test('eR3YXL09Ls')).toBe(false)
  })
})
