#!/bin/bash
# Cron Manager - 給 agents 用的 cron 管理工具
# Usage:
#   cron-manager.sh list                     列出所有任務
#   cron-manager.sh add "0 * * * * cmd"      新增任務
#   cron-manager.sh remove "pattern"         刪除符合 pattern 的任務
#   cron-manager.sh enable "pattern"         取消註解（啟用）
#   cron-manager.sh disable "pattern"        註解掉（停用）

ACTION=$1
shift

CRON_LIST=~/.openclaw/workspace/system/cron-list.txt

case "$ACTION" in
    list)
        echo "📋 目前的 Cron 任務 (Taiwan Time):"
        echo "=================================="
        crontab -l 2>/dev/null | grep -v "^#" | grep -v "^$" | grep -v "^TZ="
        ;;
    
    add)
        ENTRY="$*"
        if [ -z "$ENTRY" ]; then
            echo "❌ 請提供 cron 格式，例如: cron-manager.sh add \"0 * * * * /path/to/script.sh\""
            exit 1
        fi
        (crontab -l 2>/dev/null; echo "$ENTRY") | crontab -
        echo "✅ 已新增: $ENTRY"
        # Update list file
        ~/.openclaw/workspace/system/update-cron-list.sh
        ;;
    
    remove)
        PATTERN="$*"
        if [ -z "$PATTERN" ]; then
            echo "❌ 請提供要刪除的 pattern"
            exit 1
        fi
        BEFORE=$(crontab -l 2>/dev/null | wc -l)
        crontab -l 2>/dev/null | grep -v "$PATTERN" | crontab -
        AFTER=$(crontab -l 2>/dev/null | wc -l)
        REMOVED=$((BEFORE - AFTER))
        echo "✅ 已刪除 $REMOVED 個符合 '$PATTERN' 的任務"
        ~/.openclaw/workspace/system/update-cron-list.sh
        ;;
    
    disable)
        PATTERN="$*"
        if [ -z "$PATTERN" ]; then
            echo "❌ 請提供要停用的 pattern"
            exit 1
        fi
        crontab -l 2>/dev/null | sed "/$PATTERN/s/^/#DISABLED# /" | crontab -
        echo "✅ 已停用符合 '$PATTERN' 的任務"
        ~/.openclaw/workspace/system/update-cron-list.sh
        ;;
    
    enable)
        PATTERN="$*"
        if [ -z "$PATTERN" ]; then
            echo "❌ 請提供要啟用的 pattern"
            exit 1
        fi
        crontab -l 2>/dev/null | sed "/$PATTERN/s/^#DISABLED# //" | crontab -
        echo "✅ 已啟用符合 '$PATTERN' 的任務"
        ~/.openclaw/workspace/system/update-cron-list.sh
        ;;
    
    *)
        echo "Cron Manager - 管理排程任務"
        echo ""
        echo "用法:"
        echo "  cron-manager.sh list                    列出所有任務"
        echo "  cron-manager.sh add \"MIN HR * * * cmd\" 新增任務"
        echo "  cron-manager.sh remove \"pattern\"       刪除任務"
        echo "  cron-manager.sh disable \"pattern\"      停用任務"
        echo "  cron-manager.sh enable \"pattern\"       啟用任務"
        echo ""
        echo "範例:"
        echo "  cron-manager.sh add \"30 9 * * * echo hello\""
        echo "  cron-manager.sh remove \"hello\""
        ;;
esac
