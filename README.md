# EMOS 大乐透 Bot

基于 EMOS 萝卜经济的 Telegram 大乐透机器人：自建选号玩法 · commit-reveal 可验证开奖 · 95% 返奖 · 一等奖滚存。

> 详细设计见《详尽计划书.md》。当前状态：**核心代码完成，23/23 单测通过，全链路冒烟通过，待测试服联调。**

## 快速开始

```bash
# 1. 安装依赖（Debian 需编译环境：apt install -y build-essential python3）
npm ci

# 2. 配置
cp .env.example .env   # 填入 BOT_TOKEN / EMOS_TOKEN / BOT_NAME / ADMIN_TG_ID

# 3. 初始化数据库
npm run migrate

# 4. 测试（可选）
npm test

# 5. 启动
npm start
```

## 生产部署（Debian VPS）

```bash
# 用户与目录
useradd -m -s /bin/bash dlt
git clone https://github.com/<you>/emos-dlt-bot.git /opt/emos-dlt-bot
chown -R dlt:dlt /opt/emos-dlt-bot

cd /opt/emos-dlt-bot
sudo -u dlt cp .env.example .env && vim .env

# 依赖（better-sqlite3 需编译）
apt install -y build-essential python3
sudo -u dlt npm ci
sudo -u dlt npm run migrate

# systemd
cp deploy/emos-dlt.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now emos-dlt
journalctl -u emos-dlt -f

# 可选：web 回调（PUBLIC_URL）—— Caddy 自动 HTTPS
apt install -y caddy && cp deploy/Caddyfile /etc/caddy/
# 编辑域名后：systemctl reload caddy

# 更新
sudo -u dlt git pull && sudo -u dlt npm ci && systemctl restart emos-dlt
```

## 运维

- **备份**（crontab -e）：`0 3 * * * sqlite3 /opt/emos-dlt-bot/data/dlt.db ".backup /opt/emos-dlt-bot/backups/dlt-$(date +\%F).db"`
- **开奖验证**：`node scripts/verify-draw.js <期号>`（用户可用公布 seed 复算：`node scripts/verify-draw.js <期号> <seed>`）
- **返奖率校准**：`npm run simulate -- --issues=10000 --bets=300`
- **管理员命令**（bot 内）：`/admin stats` `close` `draw` `resend`

## 架构速览

```
grammY (polling) ── 投注向导/绑定/查询
    │
    ├── emos API (pay/create · pay/query · pay/transfer · sign/check)
    ├── better-sqlite3 (WAL) — orders/bets/issues/prizes/rollover
    ├── node-cron — 开售/停售/开奖/对账/派奖
    └── Fastify :8787 — /emos/notify (web 回调) + /healthz
```

## 安全要点

- 入账唯一依据：emos `pay/query` 二次确认（deeplink/webhook/对账三通道幂等汇聚）
- 迟到支付自动退款；派奖 >50000 自动拆分 + 指数退避重试
- commit-reveal：开售公布 seed 哈希，开奖公布 seed，`scripts/verify-draw.js` 可独立复算
- .env 不入库（.gitignore），systemd 加固运行

## 关于滚存的数学说明（重要）

大乐透一等奖命中概率为 **1 / 8,145,060**（C(35,5)×C(12,2)）。以日活 330、每期约 1-2k 注的规模，单期一等奖期望命中数约 **1/4000 ~ 1/8000**——意味着绝大多数期的一等奖池（浮动池 75%）无人认领，**全额滚存**，奖池逐期累积，直到某天引爆为巨额头奖。这是滚存玩法的正常设计（与体彩大乐透同理），不是奖金丢失：

- 蒙特卡洛验证（5000 期 × 300 注）：短期实际派发率 44-61%，差额全部进入滚存余额，账目可查（`rollover_ledger` 表）
- 长期返奖率收敛于 95%（需百万期量级验证，代码逻辑已由单测覆盖）
- 固定奖（四至九等奖）不受滚存影响，照常即中即派
- **运营建议**：公示消息中突出「当前滚存奖池」，把累积的奖金作为卖点；或在滚存超过阈值时用 `/admin close` 停售一期再以特别期名义重开，制造话题

## 待办（测试服联调清单）

- [ ] emos 测试服真实走通：/bind 授权回跳 → signCheck
- [ ] pay/create 真实创建 → 支付 → deeplink 回跳确认
- [ ] pay/query 响应字段确认（`isOrderPaid` 的判定字段需按真实响应收紧）
- [ ] transfer 真实转账（千 6 费率核对）
- [ ] web 回调（PUBLIC_URL 配置后）重试验证
- [ ] 投注向导全流程 UX 走查（自选/机选/复式/守号）
- [ ] 开奖 → 推送 → 派奖全链路带真实用户测试
