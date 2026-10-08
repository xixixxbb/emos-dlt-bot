# EMOS 大乐透 Bot

基于 EMOS 萝卜经济的 Telegram 大乐透机器人：自建选号玩法 · commit-reveal 可验证开奖 · 95% 返奖 · 一等奖滚存。

> 详细设计见《详尽计划书.md》。当前状态：**核心代码完成，23/23 单测通过，模块链接自检通过，待测试服联调。**

## 部署（Debian VPS）

```bash
# 1. 基础环境（build-essential 必须在 npm install 之前装好）
apt update && apt install -y git curl build-essential python3
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
node -v && npm -v                    # 需 >= 20

# 2. 拉代码
git clone https://github.com/xixixxbb/emos-dlt-bot.git /opt/emos-dlt-bot
cd /opt/emos-dlt-bot
cp .env.example .env && nano .env    # 填 BOT_TOKEN / EMOS_TOKEN / BOT_NAME / ADMIN_TG_ID

# 3. 安装依赖
npm ci

# 4. 自检（强烈建议，30 秒内出结果）
npm run check      # import 路径静态检查
npm test           # 单元测试（23 项）

# 5. 初始化数据库
npm run migrate

# 6. 前台试运行（Ctrl+C 停止）
npm start
```

确认日志输出 `EMOS 大乐透 bot 已启动 🎰` 后，改用 systemd 常驻（`systemctl` 方案见下），**不要长期用 `npm start` 裸跑**——SSH 断开即停，且无自动重启。

### systemd 常驻

```bash
useradd -m -s /bin/bash dlt                 # 专用用户（unit 文件里写的是 dlt）
chown -R dlt:dlt /opt/emos-dlt-bot
cp deploy/emos-dlt.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now emos-dlt
journalctl -u emos-dlt -f                   # 看日志
```

> 若你把代码放在 `/root` 或别处，请先改 `deploy/emos-dlt.service` 里的 `WorkingDirectory`、`EnvironmentFile`、`ReadWritePaths` 和 `User`，否则会启动失败。

### 更新流程

```bash
cd /opt/emos-dlt-bot
git pull
npm ci                 # 依赖有变动时才需要
systemctl restart emos-dlt
```

### 可选：web 回调（HTTPS）

```bash
apt install -y caddy
cp deploy/Caddyfile /etc/caddy/Caddyfile    # 改成你的域名
# .env 里配置 PUBLIC_URL=https://你的域名
systemctl reload caddy && systemctl restart emos-dlt
```

未配置 `PUBLIC_URL` 时为**纯轮询对账模式**（deeplink 回跳 + 每 5 分钟 `pay/query` 兜底补单），功能完整，只是丢单补偿慢几分钟。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm start` | 启动 bot（前台） |
| `npm run check` | 静态检查所有相对 import 是否可解析（防部署期 `ERR_MODULE_NOT_FOUND`） |
| `npm test` | 单元测试（奖级/结算/公平开奖/deeplink） |
| `npm run migrate` | 初始化/升级数据库 |
| `npm run simulate -- --issues=5000 --bets=300` | 蒙特卡洛返奖率校准 |
| `npm run verify-draw -- <期号>` | 复算开奖号码（外部验证可传 seed：`-- <期号> <seed>`） |
| `/admin stats\|close\|draw\|resend` | bot 内管理员命令 |

## 排错

| 现象 | 原因与处理 |
|------|-----------|
| `ERR_MODULE_NOT_FOUND ... /config/index.js` | 旧版本 import 路径层级错误，`git pull` 拉取最新代码即可（已修复） |
| `Cannot find module 'better-sqlite3'` / 原生模块加载失败 | 先装 `build-essential python3`，再 `npm rebuild better-sqlite3`；npm 11+ 若提示 install-scripts 被拦截：`npm install-scripts approve better-sqlite3` 后 `npm rebuild better-sqlite3` |
| 启动时报缺少环境变量 | `.env` 未填全，`src/config/index.js` 会逐项列出缺哪个 |
| `401 Unauthorized`（getMe 失败） | `BOT_TOKEN` 错误或已被 BotFather 重置 |
| 日志 `PUBLIC_URL 未配置` | 正常提示，纯轮询模式运行 |

## 运维

- **备份**（`crontab -e`）：`0 3 * * * sqlite3 /opt/emos-dlt-bot/data/dlt.db ".backup /opt/emos-dlt-bot/backups/dlt-$(date +\%F).db"`
- **健康检查**：配置 `PUBLIC_URL` 后可访问 `https://你的域名/healthz`
- **开奖验证**：`npm run verify-draw -- <期号>`

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
- commit-reveal：开售公布 seed 哈希，开奖公布 seed，`npm run verify-draw` 可独立复算
- `.env` 不入库（.gitignore），systemd 加固运行

## 关于滚存的数学说明（重要）

大乐透一等奖命中概率为 **1 / 8,145,060**（C(35,5)×C(12,2)）。以日活 330、每期约 1-2k 注的规模，单期一等奖期望命中数约 **1/4000 ~ 1/8000**——意味着绝大多数期的一等奖池（浮动池 75%）无人认领，**全额滚存**，奖池逐期累积，直到某天引爆为巨额头奖。这是滚存玩法的正常设计（与体彩大乐透同理），不是奖金丢失：

- 蒙特卡洛验证（5000 期 × 300 注）：短期实际派发率 44-61%，差额全部进入滚存余额，账目可查（`rollover_ledger` 表）
- 固定奖（四至九等奖）不受滚存影响，照常即中即派
- **运营建议**：公示消息中突出「当前滚存奖池」，把累积的奖金作为卖点；或在滚存超过阈值时用 `/admin close` 停售一期再以特别期名义重开，制造话题

## 待办（测试服联调清单）

- [ ] emos 测试服真实走通：/bind 授权回跳 → signCheck
- [ ] pay/create 真实创建 → 支付 → deeplink 回跳确认
- [ ] pay/query 响应字段确认（`isOrderPaid` 判定字段需按真实响应收紧）
- [ ] transfer 真实转账（千 6 费率核对）
- [ ] web 回调（PUBLIC_URL 配置后）重试验证
- [ ] 投注向导全流程 UX 走查（自选/机选/复式/守号）
- [ ] 开奖 → 推送 → 派奖全链路带真实用户测试
