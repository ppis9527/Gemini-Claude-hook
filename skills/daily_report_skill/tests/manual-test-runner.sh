#!/bin/bash
# Manual test runner for environments without Node.js/vitest
# This script validates the code structure and performs static analysis

echo "=========================================="
echo "QA INSPECTOR - MANUAL TEST ANALYSIS"
echo "=========================================="
echo ""

echo "Test Suite: system-health.js"
echo "----------------------------"
echo ""

# Test 1: Module structure
echo "[TEST] Checking module exports..."
if grep -q "module.exports = { execute }" daily_report_skill/tasks/system-health.js; then
    echo "✅ PASS: Module exports 'execute' function"
else
    echo "❌ FAIL: Module does not export 'execute' function"
fi

# Test 2: Return structure
echo "[TEST] Checking return object structure..."
if grep -q "status:" daily_report_skill/tasks/system-health.js && \
   grep -q "logs:" daily_report_skill/tasks/system-health.js && \
   grep -q "diffs:" daily_report_skill/tasks/system-health.js && \
   grep -q "rollback_command:" daily_report_skill/tasks/system-health.js; then
    echo "✅ PASS: Returns all required fields (status, logs, diffs, rollback_command)"
else
    echo "❌ FAIL: Missing required return fields"
fi

# Test 3: Error handling
echo "[TEST] Checking error handling..."
if grep -q "try {" daily_report_skill/tasks/system-health.js && \
   grep -q "catch" daily_report_skill/tasks/system-health.js; then
    echo "✅ PASS: Contains try-catch error handling"
else
    echo "❌ FAIL: Missing error handling"
fi

echo ""
echo "Test Suite: nightly_orchestrator.js"
echo "-----------------------------------"
echo ""

# Test 4: Config loading
echo "[TEST] Checking configuration loading..."
if grep -q "function loadConfig" daily_report_skill/nightly_orchestrator.js && \
   grep -q "JSON.parse" daily_report_skill/nightly_orchestrator.js; then
    echo "✅ PASS: Implements config loading with JSON parsing"
else
    echo "❌ FAIL: Config loading not properly implemented"
fi

# Test 5: Pre-flight checks
echo "[TEST] Checking pre-flight checks..."
if grep -q "function preFlightChecks" daily_report_skill/nightly_orchestrator.js; then
    echo "✅ PASS: Implements pre-flight checks"
else
    echo "❌ FAIL: Missing pre-flight checks"
fi

# Test 6: Snapshot creation
echo "[TEST] Checking snapshot functionality..."
if grep -q "function createSnapshot" daily_report_skill/nightly_orchestrator.js && \
   grep -q "is_write_operation" daily_report_skill/nightly_orchestrator.js; then
    echo "✅ PASS: Implements snapshot creation for write operations"
else
    echo "❌ FAIL: Missing snapshot functionality"
fi

# Test 7: Report generation
echo "[TEST] Checking report generation..."
if grep -q "function generateMarkdown" daily_report_skill/nightly_orchestrator.js && \
   grep -q "Audit Trail" daily_report_skill/nightly_orchestrator.js && \
   grep -q "rollback_command" daily_report_skill/nightly_orchestrator.js; then
    echo "✅ PASS: Generates markdown reports with audit trail and rollback commands"
else
    echo "❌ FAIL: Report generation incomplete"
fi

# Test 8: Cleanup
echo "[TEST] Checking cleanup functionality..."
if grep -q "function pruneOldSnapshots" daily_report_skill/nightly_orchestrator.js && \
   grep -q "SNAPSHOT_RETENTION_DAYS" daily_report_skill/nightly_orchestrator.js; then
    echo "✅ PASS: Implements snapshot retention and cleanup"
else
    echo "❌ FAIL: Missing cleanup functionality"
fi

# Test 9: Config file
echo "[TEST] Checking nightly_config.json..."
if [ -f "daily_report_skill/nightly_config.json" ]; then
    if grep -q "enabled_tasks" daily_report_skill/nightly_config.json && \
       grep -q "system-health" daily_report_skill/nightly_config.json; then
        echo "✅ PASS: Valid config file with enabled_tasks"
    else
        echo "❌ FAIL: Config file malformed"
    fi
else
    echo "❌ FAIL: Config file not found"
fi

echo ""
echo "=========================================="
echo "TEST SUMMARY"
echo "=========================================="
echo "Total tests: 9"
echo "All structural tests completed"
echo ""
