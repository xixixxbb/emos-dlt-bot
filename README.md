# EMOS 大乐透 Bot

基于 EMOS 萝卜经济的 Telegram 大乐透机器人：自建选号玩法 · commit-reveal 可验证开奖 · 95% 返奖 · 一等奖滚存。

> 详细设计见《详尽计划书.md》。当前状态：**核心代码完成，23/23 单测通过，模块链接自检通过，已在 VPS 上线运行，待测试服/正式服业务联调。**

## 部署（Debian VPS）

```bash
# 1. 基础环境（build-essential 必须在 npm ci 之前装好）
apt update && apt install -y git curl build-essential python3 sqlite3
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

确认日志出现 `EMOS 大乐透 bot 已启动 🎰` 后，改用 systemd 常驻。

### systemd 常驻

```bash
useradd -m -s /bin/bash dlt                 # 专用用户（unit 文件默认 User=dlt）
chown -R dlt:dlt /opt/emos-dlt-bot
cp deploy/emos-dlt.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now emos-dlt
journalctl -u emos-dlt -f                   # 看日志
```

**unit 文件故意不写 `EnvironmentFile=`**：systemd 的 env 文件解析不会剥离行内注释，`BOT_TOKEN=xxx  # 说明` 会被整段当成值传给进程，触发 zod 校验失败并无限重启。应用自身用 dotenv 加载 `.env`（能正确剥离注释），所以交给它即可。

若你把代码放在 `/root/emos-dlt-bot` 并用 root 运行，把 unit 里这几行改掉：

```ini
User=root
WorkingDirectory=/root/emos-dlt-bot
ReadWritePaths=/root/emos-dlt-bot/data /root/emos-dlt-bot/backups
# ProtectHome=true 会让 root 无法访问 /root，需删除该行
```

### 更新流程

```bash
cd /opt/emos-dlt-bot
git pull
npm ci                 # 依赖有变动时才需要
systemctl restart emos-dlt && journalctl -u emos-dlt -n 20 -f
```

### 每日备份

```bash
# 需先 apt install -y sqlite3
chmod +x deploy/backup.sh
echo '0 3 * * * root /opt/emos-dlt-bot/deploy/backup.sh >> /opt/emos-dlt-bot/backups/backup.log 2>&1' \
  > /etc/cron.d/emos-dlt-backup && chmod 644 /etc/cron.d/emos-dlt-backup
deploy/backup.sh                     # 立刻验证一次
```

保留 30 天，使用 SQLite 在线备份（WAL 模式安全）。

### 可选：web 回调（HTTPS）

```bash
apt install -y caddy
cp deploy/Caddyfile /etc/caddy/Caddyfile    # 改成你的域名
# .env 里配置 PUBLIC_URL=https://你的域名
systemctl reload caddy && systemctl restart emos-dlt
```

未配置 `PUBLIC_URL` 时为**纯轮询对账模式**（deeplink 回跳 + 每 5 分钟 `pay/query` 兜底补单），功能完整，只是丢单补偿慢几分钟。

## 账号绑定流程

授权链接格式：

```
https://t.me/emospg_bot?start=link_<接入方EmosID>-<botName>
```

**关于第一个参数的实测结论**：它是**接入方（bot 开发者）的 emos 用户 ID**，仅用于标识是哪个应用在接入，**没有实际功能作用**——既不是 Telegram ID，也不是绑定用户自己的 ID，填错/换掉都不影响授权结果。本项目的取法：优先读 `.env` 的 `EMOS_DEVELOPER_ID`，未配置则自动用服务商 token 调 `/api/sign/check` 推导（返回的 `user_id` 即该账号自己的 ID）。

绑定流程（用户侧只有两步）：

1. 用户 `/bind`（或 `/start`）→ bot 返回授权按钮
2. 用户点按钮 → 在 emos 页面点「同意」→ 自动跳回 `t.me/<bot>?start=emosLinkAgree-<用户token>` → bot 用该 token 调 `/api/sign/check` 取得 `user_id` 写入 users 表

**备用方式**：用户直接粘贴 emos 主站密钥（形如 `3945_Jxxxxxxxx`）即可绑定，无需跳转。

> `/api/pay/getUserInfo?telegram_user_id=` 需服务商权限，审核通过（`/api/pay/base` 的 `status` 不为 `review`）后可用，可用于自动核对用户身份。

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
| `ERR_MODULE_NOT_FOUND ... /config/index.js` | 旧版本 import 路径层级错误，`git pull` 拉取最新代码（已修复） |
| systemd 反复重启，日志 `环境变量校验失败：Invalid url / Expected number, received nan` | unit 里的 `EnvironmentFile=` 不剥离行内注释 → 删除该行（见上），或把 `.env` 行内注释移到独立行 |
| `Cannot find module 'better-sqlite3'` / 原生模块加载失败 | 先装 `build-essential python3`，再 `npm rebuild better-sqlite3`；npm 11+ 若提示 install-scripts 被拦截：`npm install-scripts approve better-sqlite3` 后 `npm rebuild better-sqlite3` |
| `401 Unauthorized`（getMe 失败） | `BOT_TOKEN` 错误或已被 BotFather 重置 |
| 日志 `PUBLIC_URL 未配置` | 正常提示，纯轮询模式运行 |
| 长轮询收不到消息（客户端无响应） | 检查是否残留 webhook：`getWebhookInfo` 有 url 就 `deleteWebhook` |
| 授权链接点开 emos 提示无法识别/无反应 | 链接第一个参数必须是 **emos 用户 ID**（e 开头 s 结尾 10 位），不是 Telegram 数字 ID |
| 支付接口返回「请先成为服务商」 | 服务商申请尚在审核（`GET /api/pay/base` → `status: review`），联系 @emospg 审核 |
| 启动正常但「/」菜单里没有命令 | 代码会在启动时注册 `setMyCommands`，看日志是否有「命令菜单注册失败」 |

## 运维

- **备份**：见上「每日备份」，每天 03:00 自动执行，保留 30 天
- **健康检查**：配置 `PUBLIC_URL` 后可访问 `https://你的域名/healthz`
- **开奖验证**：`npm run verify-draw -- <期号>`
- **日志**：`journalctl -u emos-dlt -f`（内存占用实测约 35 MB）

## 架构速览

```
grammY (polling) ── 投注向导/绑定/查询
    │
    ├── emos API (pay/create · pay/query · pay/transfer · sign/check)
    ├── better-sqlite3 (WAL) — orders/bets/issues/prizes/rollover
    ├── node-cron — 开售/停售/开奖/对账/派奖
    └── Fastify :8787 — /emos/notify (web 回调) + /healthz（仅 PUBLIC_URL 配置时启动）
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

## 上线检查清单

- [ ] `/start` 能收到欢迎与绑定引导
- [ ] `/bind` 输入 emos 用户 ID → 授权回跳 → `signCheck` 成功写入 users 表
- [ ] **服务商审核通过**（`/api/pay/base` 的 `status` 不再是 `review`），否则 `pay/create`、`pay/transfer`、`getUserInfo` 全部返回「请先成为服务商」
- [ ] `/bet` 全流程：自选 / 机选 / 复式 / 守号
- [ ] 真实支付：`pay/create` → 支付 → deeplink 回跳入账（或 5 分钟内对账补单）
- [ ] `pay/query` 响应字段核对，必要时收紧 `src/emos/pay.js` 的 `isOrderPaid`
- [ ] 开奖：21:00 自动出号 → 推送 → 派奖 `pay/transfer`（核对千 6 费率）
- [ ] 迟到支付退款路径
- [ ] 备份文件可用（`sqlite3 backups/dlt-<日期>.db ".tables"` 验证）
