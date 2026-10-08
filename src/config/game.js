// 玩法常量（环境无关的纯常量模块，测试/模拟脚本复用，勿引入 env 副作用）

export const GAME = {
  // 号码空间（计划书 §2.1）
  FRONT_MAX: 35,
  FRONT_PICK: 5,
  FRONT_MAX_CHOOSE: 8, // 复式前区上限
  BACK_MAX: 12,
  BACK_PICK: 2,
  BACK_MAX_CHOOSE: 4, // 复式后区上限

  // 期限与订单
  SALE_CLOSE_LEAD_MIN: 2, // 距停售 N 分钟内拒单
  ORDER_TTL_MIN: 5, // emos 订单有效期（分钟）
  RECONCILE_DELAY_MIN: 5, // 创建 N 分钟后进入对账
  TRANSFER_LIMIT: 50000, // emos transfer 单次上限
  TRANSFER_RETRY_MAX: 5,

  // 奖级（计划书 §2.2 / §2.3）
  FIXED_PRIZES: { 4: 800, 5: 250, 6: 150, 7: 50, 8: 20, 9: 10 },
  FLOAT_SHARES: { 1: 0.75, 2: 0.15, 3: 0.10 },
  FIXED_LEVELS: [4, 5, 6, 7, 8, 9],
  FLOAT_LEVELS: [1, 2, 3],
}

// 默认值（可被 .env 覆盖；集中在此便于模拟脚本复算）
export const DEFAULTS = {
  PRICE_PER_BET: 2,
  PAYOUT_RATE: 0.95,
  MAX_BETS_PER_USER: 100,
}
