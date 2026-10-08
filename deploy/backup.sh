#!/bin/sh
# EMOS 大乐透数据库每日备份（保留 30 天）
#
# 用法一：/etc/cron.d/emos-dlt-backup
#   0 3 * * * root /opt/emos-dlt-bot/deploy/backup.sh >> /opt/emos-dlt-bot/backups/backup.log 2>&1
# 用法二：crontab -e（注意 % 需转义为 \%）
#   0 3 * * * /opt/emos-dlt-bot/deploy/backup.sh >> /opt/emos-dlt-bot/backups/backup.log 2>&1
#
# 需先安装 sqlite3：apt install -y sqlite3

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
DB="$APP_DIR/data/dlt.db"
DIR="$APP_DIR/backups"
KEEP_DAYS="${KEEP_DAYS:-30}"

if [ ! -f "$DB" ]; then
  echo "[$(date '+%F %T')] 数据库不存在: $DB" >&2
  exit 1
fi

mkdir -p "$DIR"
# 使用 SQLite 在线备份（WAL 模式下安全，不会复制到写一半的状态）
sqlite3 "$DB" ".backup $DIR/dlt-$(date +%F).db" || exit 1
find "$DIR" -name "dlt-*.db" -mtime +"$KEEP_DAYS" -delete
echo "[$(date '+%F %T')] backup ok → $DIR/dlt-$(date +%F).db"
