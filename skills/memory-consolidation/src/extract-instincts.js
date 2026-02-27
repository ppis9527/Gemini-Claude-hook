#!/usr/bin/env node
/**
 * Extract instincts from agent cases and patterns.
 * Instincts are higher-level behavioral rules derived from repeated observations.
 *
 * Usage: node extract-instincts.js [--store] [--min-confidence 0.5]
 *
 * Key pattern: agent.instinct.<domain>.<id>
 * Domains: error, workflow, tool, coding, testing
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = process.env.MEMORY_DB_PATH || path.join(__dirname, '..', 'memory.db');

function generateId() {
    return crypto.randomBytes(4).toString('hex');
}

/**
 * Load all agent cases and patterns from memory.db
 */
function loadAgentMemory() {
    if (!fs.existsSync(dbPath)) return { cases: [], patterns: [] };

    const db = new Database(dbPath, { readonly: true });

    const cases = db.prepare(`
        SELECT key, value, start_time FROM memories
        WHERE key LIKE 'agent.case.%' AND end_time IS NULL
        ORDER BY start_time DESC
    `).all().map(r => {
        let value;
        try { value = JSON.parse(r.value); } catch { value = r.value; }
        return { key: r.key, value, timestamp: r.start_time };
    });

    const patterns = db.prepare(`
        SELECT key, value, start_time FROM memories
        WHERE key LIKE 'agent.pattern.%' AND end_time IS NULL
        ORDER BY start_time DESC
    `).all().map(r => ({
        key: r.key,
        value: r.value,
        timestamp: r.start_time
    }));

    db.close();
    return { cases, patterns };
}

/**
 * Extract error type from case key (e.g., "agent.case.test_failure.abc123" -> "test_failure")
 */
function extractErrorType(caseKey) {
    const parts = caseKey.split('.');
    return parts.length >= 3 ? parts[2] : 'generic';
}

/**
 * Calculate confidence based on observation count
 */
function calculateConfidence(count) {
    if (count >= 10) return 0.9;
    if (count >= 7) return 0.8;
    if (count >= 5) return 0.7;
    if (count >= 3) return 0.6;
    if (count >= 2) return 0.5;
    return 0.4;
}

/**
 * Cluster similar cases by error type and extract instincts
 */
function extractInstinctsFromCases(cases) {
    const instincts = [];
    const grouped = {};

    // Group cases by error type
    for (const c of cases) {
        const errorType = extractErrorType(c.key);
        if (!grouped[errorType]) grouped[errorType] = [];
        grouped[errorType].push(c);
    }

    // Generate instincts for groups with 2+ cases
    for (const [errorType, group] of Object.entries(grouped)) {
        if (group.length < 2) continue;

        // Find common solution patterns
        const toolCounts = {};
        const solutions = [];

        for (const c of group) {
            const val = c.value;
            if (val?.solution?.tools) {
                for (const tool of val.solution.tools) {
                    toolCounts[tool] = (toolCounts[tool] || 0) + 1;
                }
            }
            if (val?.solution?.description) {
                solutions.push(val.solution.description);
            }
            if (val?.solution?.actions) {
                solutions.push(...val.solution.actions);
            }
        }

        // Find most common tools
        const commonTools = Object.entries(toolCounts)
            .filter(([, count]) => count >= Math.ceil(group.length / 2))
            .map(([tool]) => tool);

        // Generate instinct
        const confidence = calculateConfidence(group.length);
        const trigger = `when encountering ${errorType.replace(/_/g, ' ')} error`;
        const action = commonTools.length > 0
            ? `Use ${commonTools.join(', ')} to resolve. ${solutions[0]?.slice(0, 100) || ''}`
            : solutions[0]?.slice(0, 150) || `Check ${errorType} conditions`;

        instincts.push({
            key: `agent.instinct.error.${errorType}`,
            value: JSON.stringify({
                trigger,
                action: action.trim(),
                confidence,
                domain: 'error',
                evidence_count: group.length,
                common_tools: commonTools,
                last_observed: group[0].timestamp,
                source: 'auto:case-aggregation'
            }),
            source: 'auto:instinct-extraction'
        });
    }

    return instincts;
}

/**
 * Extract workflow instincts from patterns
 */
function extractInstinctsFromPatterns(patterns) {
    const instincts = [];
    const workflowPatterns = patterns.filter(p => p.key.includes('.workflow_'));
    const sequencePatterns = patterns.filter(p => p.key.includes('.sequence_'));
    const frequentPatterns = patterns.filter(p => p.key.includes('.frequent_'));

    // Workflow instincts
    if (workflowPatterns.length >= 2) {
        // Extract common tools from workflows
        const toolMentions = {};
        for (const p of workflowPatterns) {
            const match = p.value.match(/Successful workflow: ([^(]+)/);
            if (match) {
                const tools = match[1].split('→').map(t => t.trim());
                for (const tool of tools) {
                    toolMentions[tool] = (toolMentions[tool] || 0) + 1;
                }
            }
        }

        const commonTools = Object.entries(toolMentions)
            .filter(([, count]) => count >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([tool]) => tool);

        if (commonTools.length >= 2) {
            instincts.push({
                key: `agent.instinct.workflow.common_sequence`,
                value: JSON.stringify({
                    trigger: 'when executing multi-step tasks',
                    action: `Follow pattern: ${commonTools.join(' → ')}`,
                    confidence: calculateConfidence(workflowPatterns.length),
                    domain: 'workflow',
                    evidence_count: workflowPatterns.length,
                    tools: commonTools,
                    source: 'auto:pattern-aggregation'
                }),
                source: 'auto:instinct-extraction'
            });
        }
    }

    // Tool preference instincts
    for (const p of frequentPatterns) {
        const match = p.value.match(/Tool (\w+) used (\d+) times/);
        if (match) {
            const tool = match[1];
            const count = parseInt(match[2], 10);

            if (count >= 10) {
                instincts.push({
                    key: `agent.instinct.tool.prefer_${tool.toLowerCase()}`,
                    value: JSON.stringify({
                        trigger: `when ${tool.toLowerCase()} functionality is needed`,
                        action: `Prefer using ${tool} tool`,
                        confidence: calculateConfidence(Math.min(count / 2, 10)),
                        domain: 'tool',
                        evidence_count: count,
                        source: 'auto:frequency-analysis'
                    }),
                    source: 'auto:instinct-extraction'
                });
            }
        }
    }

    // Sequence instincts
    const seqCounts = {};
    for (const p of sequencePatterns) {
        const match = p.value.match(/Common sequence: ([^(]+)/);
        if (match) {
            const seq = match[1].trim();
            seqCounts[seq] = (seqCounts[seq] || 0) + 1;
        }
    }

    for (const [seq, count] of Object.entries(seqCounts)) {
        if (count >= 2) {
            const tools = seq.split('→').map(t => t.trim());
            const seqId = tools.map(t => t.toLowerCase().slice(0, 3)).join('_');

            instincts.push({
                key: `agent.instinct.workflow.seq_${seqId}`,
                value: JSON.stringify({
                    trigger: `when performing ${tools[0].toLowerCase()} operations`,
                    action: `Follow with: ${tools.slice(1).join(' → ')}`,
                    confidence: calculateConfidence(count * 2),
                    domain: 'workflow',
                    evidence_count: count,
                    sequence: tools,
                    source: 'auto:sequence-analysis'
                }),
                source: 'auto:instinct-extraction'
            });
        }
    }

    return instincts;
}

/**
 * Load existing instincts to avoid duplicates
 */
function loadExistingInstincts() {
    if (!fs.existsSync(dbPath)) return new Set();

    const db = new Database(dbPath, { readonly: true });
    db.pragma('busy_timeout = 5000');
    const rows = db.prepare(`
        SELECT key FROM memories WHERE key LIKE 'agent.instinct.%' AND end_time IS NULL
    `).all();
    db.close();

    return new Set(rows.map(r => r.key));
}

/**
 * Store instincts to database
 */
function storeInstincts(instincts) {
    if (instincts.length === 0) return;

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 10000'); // Wait up to 10s if DB is locked
    const now = new Date().toISOString();

    // Close old versions of instincts being updated
    const closeOld = db.prepare(`
        UPDATE memories SET end_time = ? WHERE key = ? AND end_time IS NULL
    `);

    const insert = db.prepare(`
        INSERT INTO memories (key, value, source, start_time, end_time)
        VALUES (?, ?, ?, ?, NULL)
    `);

    const transaction = db.transaction(() => {
        for (const instinct of instincts) {
            closeOld.run(now, instinct.key);
            insert.run(instinct.key, instinct.value, instinct.source, now);
        }
    });

    transaction();
    db.close();
}

/**
 * Main extraction function
 */
function extractInstincts(minConfidence = 0.5) {
    const { cases, patterns } = loadAgentMemory();
    const existingKeys = loadExistingInstincts();

    console.error(`Loaded ${cases.length} cases, ${patterns.length} patterns`);

    const instincts = [];

    // Extract from cases
    const caseInstincts = extractInstinctsFromCases(cases);
    instincts.push(...caseInstincts);

    // Extract from patterns
    const patternInstincts = extractInstinctsFromPatterns(patterns);
    instincts.push(...patternInstincts);

    // Filter by confidence and dedupe by key
    const seen = new Set();
    const filtered = instincts.filter(i => {
        const val = JSON.parse(i.value);
        if (val.confidence < minConfidence) return false;
        if (seen.has(i.key)) return false;
        seen.add(i.key);
        return true;
    });

    console.error(`Generated ${filtered.length} instincts (min confidence: ${minConfidence})`);
    return filtered;
}

// CLI entry point
if (require.main === module) {
    const args = process.argv.slice(2);
    const storeMode = args.includes('--store');
    const minConfIdx = args.indexOf('--min-confidence');
    const minConfidence = minConfIdx !== -1 ? parseFloat(args[minConfIdx + 1]) : 0.5;

    const instincts = extractInstincts(minConfidence);

    // Output as JSON
    console.log(JSON.stringify(instincts.map(i => ({
        key: i.key,
        value: JSON.parse(i.value)
    })), null, 2));

    if (storeMode && instincts.length > 0) {
        storeInstincts(instincts);
        console.error(`Stored ${instincts.length} instinct(s) to database.`);
    }
}

module.exports = { extractInstincts, storeInstincts };
