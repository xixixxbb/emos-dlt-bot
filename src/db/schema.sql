-- EMOS 大乐透 计划书 §4 数据模型
-- 时间统一存 UTC（YYYY-MM-DD HH:MM:SS）

CREATE TABLE IF NOT EXISTS users (
  tg_id        INTEGER PRIMARY KEY,              -- Telegram user id
  emos_user_id TEXT UNIQUE NOT NULL,             -- emos pn，如 eWD3N7EX8s
  emos_token   TEXT NOT NULL,                   -- 绑定时获得的用户 token（sign/check 用）
  username     TEXT,
  is_banned    INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now')),
  bound_at     TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  no             TEXT UNIQUE NOT NULL,           -- emos 订单号（幂等唯一键）
  tg_id          INTEGER NOT NULL REFERENCES users(tg_id),
  issue_no       TEXT NOT NULL,                  -- 期号
  amount         INTEGER NOT NULL,               -- 萝卜金额 = 注数 × 注价
  bet_count      INTEGER NOT NULL,
  param          TEXT,                           -- 我方生成的回传标识
  status         TEXT NOT NULL DEFAULT 'created',-- created/paid/expired/closed/failed
  pay_url        TEXT,
  expires_at     TEXT,
  paid_at        TEXT,
  confirmed_at   TEXT,
  notify_channel TEXT,                           -- deeplink | webhook | reconcile
  refunded       INTEGER DEFAULT 0,              -- 迟到支付自动退款标记
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_issue  ON orders(issue_no, status);
CREATE INDEX IF NOT EXISTS idx_orders_tg     ON orders(tg_id, status);

CREATE TABLE IF NOT EXISTS bets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  tg_id        INTEGER NOT NULL,
  issue_no     TEXT NOT NULL,
  front        TEXT NOT NULL,                    -- "01,05,12,23,34"（单式一行一注）
  back         TEXT NOT NULL,                    -- "03,09"
  is_quickpick INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bets_issue ON bets(issue_no);
CREATE INDEX IF NOT EXISTS idx_bets_tg    ON bets(tg_id, issue_no);

CREATE TABLE IF NOT EXISTS favorite_bets (
  tg_id INTEGER NOT NULL,
  name  TEXT NOT NULL,
  front TEXT NOT NULL,
  back  TEXT NOT NULL,
  PRIMARY KEY (tg_id, name)
);

CREATE TABLE IF NOT EXISTS issues (
  issue_no     TEXT PRIMARY KEY,                 -- YYYYMMDD
  status       TEXT NOT NULL DEFAULT 'selling',  -- selling/closed/drawing/drawn/settled/draw_failed/settle_partial
  sale_close_at TEXT NOT NULL,
  draw_at      TEXT NOT NULL,
  seed_hash    TEXT,                             -- 开售时公布
  seed         TEXT,                             -- 开奖后公布（开售即存库但不外泄）
  draw_front   TEXT,                             -- "02,09,15,27,33"
  draw_back    TEXT,                             -- "04,11"
  sales        INTEGER DEFAULT 0,                -- 累计销售额（萝卜，入账时累加）
  pool_total   INTEGER,                          -- 当期奖池（结算时写入，幂等标志）
  fixed_paid   INTEGER,
  float_pool   INTEGER,
  rolled_in    INTEGER DEFAULT 0,                -- 期初滚存余额
  rolled_out   INTEGER,                          -- 期末滚出余额
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prizes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_no    TEXT NOT NULL REFERENCES issues(issue_no),
  tg_id       INTEGER NOT NULL,
  bet_id      INTEGER NOT NULL REFERENCES bets(id),
  level       INTEGER NOT NULL,                  -- 1..9
  amount      INTEGER NOT NULL,                  -- 单注奖金（结算时写入）
  transfer_no TEXT,                              -- 派奖批次号（审计用）
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending/transferred/failed
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prizes_issue ON prizes(issue_no, level);
CREATE INDEX IF NOT EXISTS idx_prizes_status ON prizes(issue_no, status);

-- 派奖/退款统一重试队列（kind: prize=中奖派奖 / refund=迟到支付退款）
CREATE TABLE IF NOT EXISTS transfer_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL DEFAULT 'prize',
  ref_id        INTEGER NOT NULL,                -- prizes.id 或 orders.id
  tg_id         INTEGER NOT NULL,
  amount        INTEGER NOT NULL,
  attempts      INTEGER DEFAULT 0,
  last_error    TEXT,
  next_retry_at TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rollover_ledger (
  issue_no TEXT PRIMARY KEY,
  balance  INTEGER NOT NULL                      -- 期末滚存余额
);

CREATE TABLE IF NOT EXISTS loss_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_no   TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  reason     TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id      INTEGER,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
