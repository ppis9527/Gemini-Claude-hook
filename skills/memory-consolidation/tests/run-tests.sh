#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(dirname "$0")
TESTS_DIR="$SCRIPT_DIR"

echo "=== Memory Consolidation Test Suite ==="
echo ""

PASS=0
FAIL=0

for test_file in "$TESTS_DIR"/test-*.js; do
    name=$(basename "$test_file")
    echo "--- Running: $name ---"
    if node --test "$test_file"; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
    fi
    echo ""
done

echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
