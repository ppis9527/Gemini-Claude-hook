#!/bin/bash

set -euo pipefail

# Memory Pipeline Runner
# Usage (single file):  ./run_pipeline.sh <input_file_path>
# Usage (backfill):     ./run_pipeline.sh --backfill <directory_of_jsonl_files>
# Usage (all agents):   ./run_pipeline.sh --backfill-all-openclaw-agents
# Usage (gemini):       ./run_pipeline.sh --gemini

SCRIPT_DIR=$(dirname "$0")
SRC_DIR="$SCRIPT_DIR/src"

FACTS_FILE="$SRC_DIR/facts.jsonl"
TIMED_FACTS_FILE="$SRC_DIR/timed_facts.jsonl"
export FACTS_FILE
export TIMED_FACTS_FILE

# Anti-OOM: cap sessions per run and check RAM before each extraction
MAX_SESSIONS_PER_RUN=${MAX_SESSIONS_PER_RUN:-50}
MIN_FREE_MB=300

check_ram() {
    local free_kb
    free_kb=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
    local free_mb=$((free_kb / 1024))
    if [ "$free_mb" -lt "$MIN_FREE_MB" ]; then
        echo "  ⚠ Low RAM: ${free_mb}MB free (min ${MIN_FREE_MB}MB). Stopping early."
        return 1
    fi
    return 0
}

run_extraction_for_file() {
    local input_file="$1"
    check_ram || return 1
    echo "  Extracting: $input_file"
    node "$SRC_DIR/1-extract-facts.js" "$input_file"
}

run_agent_learnings_for_file() {
    local input_file="$1"
    # Extract agent learnings (cases/patterns) and store directly to DB
    # Output is JSON array, --store flag commits to memory.db
    node "$SRC_DIR/extract-agent-learnings.js" "$input_file" --store 2>/dev/null || true
}

if [ "${1:-}" = "--gemini" ]; then
    GEMINI_OUTPUT_DIR="/tmp/gemini-converted-$$"
    echo "--- Gemini CLI ingestion at $(date) ---"

    echo "Converting Gemini sessions to JSONL..."
    node "$SRC_DIR/convert-gemini-sessions.js" --output-dir "$GEMINI_OUTPUT_DIR"

    # Clear intermediate files
    > "$FACTS_FILE"
    > "$TIMED_FACTS_FILE"

    shopt -s nullglob
    FILES=("$GEMINI_OUTPUT_DIR"/*.jsonl)
    if [ ${#FILES[@]} -eq 0 ]; then
        echo "No new Gemini sessions to process."
        rm -rf "$GEMINI_OUTPUT_DIR"
        exit 0
    fi

    TOTAL=${#FILES[@]}
    if [ "$TOTAL" -gt "$MAX_SESSIONS_PER_RUN" ]; then
        echo "⚠ Capping at $MAX_SESSIONS_PER_RUN sessions (${TOTAL} available). Remaining will be processed next run."
        TOTAL=$MAX_SESSIONS_PER_RUN
    fi

    echo "Step 1: Extracting facts from ${TOTAL} converted sessions..."
    COUNT=0
    for f in $(printf '%s\n' "${FILES[@]}" | sort); do
        COUNT=$((COUNT + 1))
        [ "$COUNT" -gt "$MAX_SESSIONS_PER_RUN" ] && break
        run_extraction_for_file "$f" || { echo "  Extraction stopped (RAM/error)."; break; }
        run_agent_learnings_for_file "$f"
    done

    # Clean up temp dir
    rm -rf "$GEMINI_OUTPUT_DIR"

elif [ "${1:-}" = "--backfill" ]; then
    DIR="${2:-}"
    if [ -z "$DIR" ]; then
        echo "Usage: $0 --backfill <directory>"
        exit 1
    fi

    echo "--- Backfill mode: $DIR at $(date) ---"

    # Clear intermediate files once at the start so all days' facts accumulate together
    > "$FACTS_FILE"
    > "$TIMED_FACTS_FILE"

    shopt -s nullglob
    FILES=("$DIR"/*.jsonl)
    if [ ${#FILES[@]} -eq 0 ]; then
        echo "No .jsonl files found in $DIR"
        exit 1
    fi

    echo "Step 1: Extracting facts from ${#FILES[@]} files (in date order)..."
    for f in $(printf '%s\n' "${FILES[@]}" | sort); do
        run_extraction_for_file "$f" || { echo "  Extraction stopped (RAM/error)."; break; }
        run_agent_learnings_for_file "$f"
    done

elif [ "${1:-}" = "--backfill-all-openclaw-agents" ]; then
    echo "--- Backfill mode: All OpenClaw Agents at $(date) ---"
    
    # Clear intermediate files once at the start so all days' facts accumulate together
    > "$FACTS_FILE"
    > "$TIMED_FACTS_FILE"

    ALL_AGENT_SESSIONS_DIR="${OPENCLAW_AGENTS_DIR:-$HOME/.openclaw/agents}"
    FOUND_FILES=()

    shopt -s nullglob # Allow glob to expand to nothing if no matches
    for AGENT_DIR in "$ALL_AGENT_SESSIONS_DIR"/*/; do
        AGENT_ID=$(basename "$AGENT_DIR")
        SESSION_DIR="${AGENT_DIR}sessions"
        if [ -d "$SESSION_DIR" ]; then
            for f in "$SESSION_DIR"/*.jsonl; do
                FOUND_FILES+=("$f")
            done
        fi
    done
    shopt -u nullglob # Turn off nullglob

    if [ ${#FOUND_FILES[@]} -eq 0 ]; then
        echo "No .jsonl files found in any OpenClaw agent sessions directories."
        exit 0
    fi

    echo "Step 1: Extracting facts from ${#FOUND_FILES[@]} files (in date order)..."
    # Sort ensures chronological order
    for f in $(printf '%s\n' "${FOUND_FILES[@]}" | sort); do
        run_extraction_for_file "$f" || { echo "  Extraction stopped (RAM/error)."; break; }
        run_agent_learnings_for_file "$f"
    done

else
    INPUT_FILE="${1:-}"
    if [ -z "$INPUT_FILE" ]; then
        echo "Usage: $0 <input_file_path>"
        echo "       $0 --backfill <directory>"
        echo "       $0 --backfill-all-openclaw-agents"
        echo "       $0 --gemini"
        exit 1
    fi

    echo "--- Processing: $INPUT_FILE at $(date) ---"

    # Clear intermediate files before each fresh single-file run
    > "$FACTS_FILE"
    > "$TIMED_FACTS_FILE"

    echo "Step 1: Extracting facts..."
    node "$SRC_DIR/1-extract-facts.js" "$INPUT_FILE"
    run_agent_learnings_for_file "$INPUT_FILE"
fi

echo "Step 2: Aligning facts temporally..."
node "$SRC_DIR/2-align-temporally.js"

echo "Step 3: Committing to database..."
node "$SRC_DIR/3-commit-to-db.js"

echo "Step 4: Generating memory digest..."
node "$SRC_DIR/4-generate-digest.js"

echo "Step 5: Embedding new facts..."
node "$SRC_DIR/5-embed-facts.js"

echo "Step 6: Generating daily log..."
node "$SRC_DIR/6-generate-daily-log.js"

echo "--- Finished at $(date) ---"
