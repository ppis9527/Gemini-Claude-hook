#!/bin/bash
# email-triage.sh - 批量整理 Gmail 郵件
#
# Usage:
#   ./email-triage.sh --dry-run     # 只統計，不執行動作
#   ./email-triage.sh --phase1      # 執行自動規則 (archive 已知 patterns)
#   ./email-triage.sh --phase2      # Archive 舊郵件 (1年前已讀)
#   ./email-triage.sh --stats       # 統計剩餘郵件
#   ./email-triage.sh --batch       # 產生批次檔給 LLM 分類
#   ./email-triage.sh --all         # 執行全部
#
# gog CLI reference:
#   Search:  gog gmail search "query" --max N --json
#   Archive: gog gmail thread modify <threadId> --remove INBOX
#   Star:    gog gmail thread modify <threadId> --add STARRED
#   Trash:   gog gmail thread modify <threadId> --add TRASH
#   Labels:  gog gmail labels ls --json

set -e

# Config
GOG_ACCOUNT="${GOG_ACCOUNT:-jerryyrliu@gmail.com}"
WORK_DIR="${HOME}/.openclaw/workspace/data/email-triage"
LOG_FILE="${WORK_DIR}/triage.log"
BATCH_SIZE=50
OLD_EMAIL_DAYS=365

# Auto-archive patterns (newsletters, notifications, etc.)
AUTO_ARCHIVE_PATTERNS=(
    "noreply@"
    "no-reply@"
    "newsletter@"
    "notifications@"
    "notification@"
    "notify@"
    "mailer@"
    "donotreply@"
    "do-not-reply@"
    "updates@"
    "info@"
    "marketing@"
    "promo@"
    "news@"
)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN:${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

# Setup
setup() {
    mkdir -p "$WORK_DIR"
    echo "=== Email Triage $(date) ===" >> "$LOG_FILE"
    # Cache GOG password for the session
    GOG_PASSWORD=$(gcloud secrets versions access latest --secret=GOG_KEYRING_PASSWORD 2>/dev/null || echo "")
    export GOG_KEYRING_PASSWORD="$GOG_PASSWORD"
}

# Run gog command with auth
gog_cmd() {
    gog "$@" --account "$GOG_ACCOUNT"
}

# Phase 1: Auto-archive known patterns
phase1_auto_archive() {
    local dry_run=$1
    log "Phase 1: Auto-archive known patterns..."

    local total_archived=0

    for pattern in "${AUTO_ARCHIVE_PATTERNS[@]}"; do
        log "  Checking: from:${pattern}..."

        local result
        result=$(gog_cmd gmail search "from:${pattern} in:inbox" --max 500 --json 2>/dev/null || echo '{"threads":[]}')
        local count
        count=$(echo "$result" | jq -r '.threads // [] | length')
        count=${count:-0}

        if [[ "$count" -gt 0 ]]; then
            if [ "$dry_run" = "true" ]; then
                log "    [DRY-RUN] Would archive $count threads from ${pattern}"
            else
                log "    Archiving $count threads from ${pattern}..."
                echo "$result" | jq -r '.threads[].id' | \
                    while read -r id; do
                        gog_cmd gmail thread modify "$id" --remove INBOX --force 2>/dev/null || true
                    done
                total_archived=$((total_archived + count))
            fi
        fi
    done

    log "Phase 1 complete. Archived: $total_archived threads"
}

# Phase 2: Archive old read emails
phase2_archive_old() {
    local dry_run=$1
    local cutoff_date=$(date -d "-${OLD_EMAIL_DAYS} days" '+%Y/%m/%d')

    log "Phase 2: Archive old emails (before $cutoff_date, read only)..."

    local query="in:inbox is:read before:${cutoff_date}"
    local result
    result=$(gog_cmd gmail search "$query" --max 2000 --json 2>/dev/null || echo '{"threads":[]}')
    local count
    count=$(echo "$result" | jq -r '.threads // [] | length')
    count=${count:-0}

    if [[ "$count" -gt 0 ]]; then
        if [ "$dry_run" = "true" ]; then
            log "  [DRY-RUN] Would archive $count old read threads"
        else
            log "  Archiving $count old read threads..."
            echo "$result" | jq -r '.threads[].id' | \
                while read -r id; do
                    gog_cmd gmail thread modify "$id" --remove INBOX --force 2>/dev/null || true
                done
            log "  Archived $count old threads"
        fi
    else
        log "  No old read emails to archive"
    fi
}

# Stats: Analyze remaining emails
stats() {
    log "Analyzing remaining emails in inbox..."

    # Get all inbox emails
    local output_file="${WORK_DIR}/inbox-summary.json"
    gog_cmd gmail search "in:inbox" --max 5000 --json > "$output_file" 2>/dev/null

    local total
    total=$(jq -r '.threads // [] | length' "$output_file")
    log "Total threads in inbox: ${total:-0}"

    # Top senders
    log ""
    log "Top 20 senders:"
    jq -r '.threads[].from // "unknown"' "$output_file" | \
        sed 's/.*<\(.*\)>/\1/' | \
        sort | uniq -c | sort -rn | head -20 | \
        while read count sender; do
            printf "  %5d  %s\n" "$count" "$sender"
        done | tee -a "$LOG_FILE"

    # Unread count
    local unread
    unread=$(jq -r '[.threads[] | select(.labels | index("UNREAD"))] | length' "$output_file")
    log ""
    log "Unread: ${unread:-0}"

    # By age (use date field from search results)
    log ""
    log "By age:"
    jq -r '.threads[].date // ""' "$output_file" | \
        while read datestr; do
            if [ -z "$datestr" ]; then continue; fi
            ts=$(date -d "$datestr" +%s 2>/dev/null || echo 0)
            today=$(date +%s)
            days=$(( (today - ts) / 86400 ))
            if [ $days -lt 7 ]; then echo "< 1 week"
            elif [ $days -lt 30 ]; then echo "< 1 month"
            elif [ $days -lt 90 ]; then echo "< 3 months"
            elif [ $days -lt 365 ]; then echo "< 1 year"
            else echo "> 1 year"
            fi
        done | sort | uniq -c | sort -rn | tee -a "$LOG_FILE"

    log ""
    log "Full data saved to: $output_file"
}

# Generate batches for LLM classification
generate_batches() {
    log "Generating batches for LLM classification..."

    local output_file="${WORK_DIR}/inbox-summary.json"
    if [ ! -f "$output_file" ]; then
        log "Running stats first..."
        stats
    fi

    local batch_dir="${WORK_DIR}/batches"
    rm -rf "$batch_dir"
    mkdir -p "$batch_dir"

    # Extract thread id + sender + subject
    jq -r '.threads[] | "\(.id)\t\(.from // "unknown")\t\(.subject // "(no subject)")"' "$output_file" | \
        split -l $BATCH_SIZE - "${batch_dir}/batch_"

    local batch_count=$(ls "$batch_dir" | wc -l)
    log "Generated $batch_count batches (${BATCH_SIZE} threads each)"
    log "Batch files: ${batch_dir}/"

    # Generate prompt template
    cat > "${batch_dir}/prompt-template.txt" << 'PROMPT'
以下是 Gmail 郵件列表，請幫我分類每封郵件的處理方式。

格式：ID | 寄件人 | 主旨

請為每封郵件選擇一個動作：
- ARCHIVE: 不重要，歸檔
- STAR: 重要，標星
- KEEP: 保留在收件匣
- DELETE: 垃圾/廣告，刪除

輸出格式 (TSV)：
ID<TAB>ACTION<TAB>原因

郵件列表：
PROMPT

    log "Prompt template: ${batch_dir}/prompt-template.txt"
    log ""
    log "使用方式："
    log "  1. cat ${batch_dir}/batch_aa"
    log "  2. 給小序看 prompt-template.txt + batch 內容"
    log "  3. 小序回覆分類結果"
    log "  4. ./email-triage.sh --execute ${batch_dir}/results.tsv"
}

# Execute LLM decisions
execute_decisions() {
    local results_file=$1

    if [ ! -f "$results_file" ]; then
        error "Results file not found: $results_file"
        exit 1
    fi

    log "Executing decisions from: $results_file"

    local archived=0 starred=0 deleted=0 kept=0

    while IFS=$'\t' read -r id action reason; do
        case "$action" in
            ARCHIVE)
                gog_cmd gmail thread modify "$id" --remove INBOX --force 2>/dev/null && archived=$((archived + 1)) || true
                ;;
            STAR)
                gog_cmd gmail thread modify "$id" --add STARRED --force 2>/dev/null && starred=$((starred + 1)) || true
                ;;
            DELETE)
                gog_cmd gmail thread modify "$id" --add TRASH --force 2>/dev/null && deleted=$((deleted + 1)) || true
                ;;
            KEEP)
                kept=$((kept + 1))
                ;;
        esac
    done < "$results_file"

    log "Results: archived=$archived, starred=$starred, deleted=$deleted, kept=$kept"
}

# Main
main() {
    setup

    case "${1:-}" in
        --dry-run)
            log "=== DRY RUN MODE ==="
            phase1_auto_archive true
            phase2_archive_old true
            stats
            ;;
        --phase1)
            phase1_auto_archive false
            ;;
        --phase2)
            phase2_archive_old false
            ;;
        --stats)
            stats
            ;;
        --batch)
            generate_batches
            ;;
        --execute)
            execute_decisions "$2"
            ;;
        --all)
            phase1_auto_archive false
            phase2_archive_old false
            stats
            generate_batches
            ;;
        *)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --dry-run    只統計，不執行動作"
            echo "  --phase1     執行自動規則 (archive newsletters, notifications)"
            echo "  --phase2     Archive 舊郵件 (${OLD_EMAIL_DAYS}天前已讀)"
            echo "  --stats      統計剩餘郵件"
            echo "  --batch      產生批次檔給 LLM 分類"
            echo "  --execute FILE  執行 LLM 分類結果"
            echo "  --all        執行全部 (phase1 + phase2 + stats + batch)"
            echo ""
            echo "建議順序："
            echo "  1. ./email-triage.sh --dry-run    # 先看會影響多少"
            echo "  2. ./email-triage.sh --phase1     # 自動 archive 已知 patterns"
            echo "  3. ./email-triage.sh --phase2     # Archive 舊郵件"
            echo "  4. ./email-triage.sh --stats      # 看剩餘郵件統計"
            echo "  5. ./email-triage.sh --batch      # 產生批次給小序分類"
            ;;
    esac
}

main "$@"
