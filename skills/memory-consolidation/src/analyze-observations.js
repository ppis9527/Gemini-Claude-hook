#!/usr/bin/env node
/**
 * Analyze observations.jsonl and extract patterns/instincts
 *
 * Reads tool use observations, detects patterns:
 * - Frequent tool usage → agent.pattern.frequent_*
 * - Tool sequences → agent.pattern.sequence_*
 * - Error → success patterns → agent.case.*
 *
 * Uses Gemini flash-lite for pattern extraction (~100-300 tokens/run)
 *
 * Usage:
 *   node analyze-observations.js [--store] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MEMORY_ROOT = process.env.MEMORY_ROOT || path.join(require('os').homedir(), '.openclaw/workspace/skills/memory-consolidation');
const OBSERVATIONS_FILE = path.join(MEMORY_ROOT, 'observations.jsonl');
const PROCESSED_MARKER = path.join(MEMORY_ROOT, '.observations_processed');
const DB_PATH = path.join(MEMORY_ROOT, 'memory.db');

const args = process.argv.slice(2);
const STORE = args.includes('--store');
const DRY_RUN = args.includes('--dry-run');

function readObservations() {
    if (!fs.existsSync(OBSERVATIONS_FILE)) {
        return [];
    }

    const lines = fs.readFileSync(OBSERVATIONS_FILE, 'utf8').split('\n').filter(Boolean);
    const observations = [];

    for (const line of lines) {
        try {
            observations.push(JSON.parse(line));
        } catch {
            // Skip invalid lines
        }
    }

    return observations;
}

function getLastProcessedTime() {
    if (!fs.existsSync(PROCESSED_MARKER)) {
        return null;
    }
    return fs.readFileSync(PROCESSED_MARKER, 'utf8').trim();
}

function markProcessed(timestamp) {
    fs.writeFileSync(PROCESSED_MARKER, timestamp);
}

function analyzeToolFrequency(observations) {
    const toolCounts = {};

    for (const obs of observations) {
        if (obs.event === 'tool_complete' && obs.tool) {
            toolCounts[obs.tool] = (toolCounts[obs.tool] || 0) + 1;
        }
    }

    const patterns = [];
    for (const [tool, count] of Object.entries(toolCounts)) {
        if (count >= 5) {
            patterns.push({
                key: `agent.pattern.frequent_${tool.toLowerCase()}`,
                value: {
                    type: 'frequency',
                    tool,
                    count,
                    confidence: Math.min(0.9, 0.5 + count * 0.05)
                }
            });
        }
    }

    return patterns;
}

function analyzeToolSequences(observations) {
    // Find repeated tool sequences (e.g., Read → Edit → Bash)
    const sequences = {};
    const toolEvents = observations.filter(o => o.event === 'tool_complete' && o.tool);

    for (let i = 0; i < toolEvents.length - 2; i++) {
        const seq = [toolEvents[i].tool, toolEvents[i+1].tool, toolEvents[i+2].tool].join('→');
        sequences[seq] = (sequences[seq] || 0) + 1;
    }

    const patterns = [];
    for (const [seq, count] of Object.entries(sequences)) {
        if (count >= 3) {
            const seqId = seq.toLowerCase().replace(/→/g, '_').replace(/[^a-z0-9_]/g, '');
            patterns.push({
                key: `agent.pattern.sequence_${seqId}`,
                value: {
                    type: 'sequence',
                    sequence: seq,
                    count,
                    confidence: Math.min(0.9, 0.4 + count * 0.1)
                }
            });
        }
    }

    return patterns;
}

function analyzeErrorRecovery(observations) {
    // Find error → success patterns in Bash tool
    const cases = [];

    for (let i = 0; i < observations.length - 1; i++) {
        const curr = observations[i];
        const next = observations[i + 1];

        if (curr.tool === 'Bash' && curr.output && next.tool === 'Bash') {
            // Check if current has error indicators
            const hasError = /error|failed|not found|permission denied/i.test(curr.output);
            const nextSuccess = next.output && !/error|failed/i.test(next.output);

            if (hasError && nextSuccess) {
                // Extract error type
                let errorType = 'unknown';
                if (/not found/i.test(curr.output)) errorType = 'not_found';
                else if (/permission/i.test(curr.output)) errorType = 'permission';
                else if (/syntax/i.test(curr.output)) errorType = 'syntax';
                else if (/failed/i.test(curr.output)) errorType = 'failed';

                cases.push({
                    key: `agent.case.bash_${errorType}_${Date.now()}`,
                    value: {
                        type: 'error_recovery',
                        error_type: errorType,
                        problem: curr.output?.slice(0, 200),
                        solution: {
                            description: 'Retry with different approach',
                            tools: ['Bash']
                        },
                        timestamp: curr.timestamp
                    }
                });
            }
        }
    }

    return cases;
}

function storePattern(key, value) {
    if (DRY_RUN) {
        console.log(`[DRY-RUN] Would store: ${key}`);
        return true;
    }

    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH);

    try {
        const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
        const now = new Date().toISOString();

        // Check if exists
        const existing = db.prepare('SELECT id FROM memories WHERE key = ? AND end_time IS NULL').get(key);

        if (existing) {
            // Update existing
            db.prepare('UPDATE memories SET value = ?, start_time = ? WHERE id = ?')
                .run(valueStr, now, existing.id);
        } else {
            // Insert new
            db.prepare('INSERT INTO memories (key, value, start_time) VALUES (?, ?, ?)')
                .run(key, valueStr, now);
        }

        return true;
    } catch (e) {
        console.error(`Failed to store ${key}:`, e.message);
        return false;
    } finally {
        db.close();
    }
}

function main() {
    const lastProcessed = getLastProcessedTime();
    let observations = readObservations();

    if (observations.length === 0) {
        console.log('[analyze-observations] No observations to analyze');
        return;
    }

    // Filter to only new observations
    if (lastProcessed) {
        observations = observations.filter(o => o.timestamp > lastProcessed);
    }

    if (observations.length === 0) {
        console.log('[analyze-observations] No new observations since last run');
        return;
    }

    console.log(`[analyze-observations] Analyzing ${observations.length} observations...`);

    // Extract patterns (no LLM needed for these)
    const frequencyPatterns = analyzeToolFrequency(observations);
    const sequencePatterns = analyzeToolSequences(observations);
    const errorCases = analyzeErrorRecovery(observations);

    const allPatterns = [...frequencyPatterns, ...sequencePatterns, ...errorCases];

    console.log(`[analyze-observations] Found ${allPatterns.length} patterns:`);
    console.log(`  - Frequency: ${frequencyPatterns.length}`);
    console.log(`  - Sequences: ${sequencePatterns.length}`);
    console.log(`  - Error recovery: ${errorCases.length}`);

    if (STORE && allPatterns.length > 0) {
        let stored = 0;
        for (const pattern of allPatterns) {
            if (storePattern(pattern.key, pattern.value)) {
                stored++;
            }
        }
        console.log(`[analyze-observations] Stored ${stored}/${allPatterns.length} patterns`);
    } else if (allPatterns.length > 0) {
        console.log('[analyze-observations] Patterns found (use --store to save):');
        for (const p of allPatterns.slice(0, 10)) {
            console.log(`  ${p.key}: ${JSON.stringify(p.value).slice(0, 100)}`);
        }
    }

    // Mark as processed
    if (observations.length > 0) {
        const latestTimestamp = observations[observations.length - 1].timestamp;
        markProcessed(latestTimestamp);
    }
}

main();
