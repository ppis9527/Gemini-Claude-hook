#!/usr/bin/env node
/**
 * evolve-instructions.js — Self-Evolution Agent
 *
 * Analyzes agent cases/patterns to generate actionable instructions.
 * Unlike extract-instincts.js (rule-based aggregation), this uses LLM
 * to synthesize concrete behavioral instructions from case clusters.
 *
 * Pipeline:
 *   1. Load recent cases from memory.db
 *   2. Cluster by similarity (problem description)
 *   3. For each cluster: LLM synthesizes instruction
 *   4. Score instruction (novelty vs existing instructions)
 *   5. Write to evolved-instructions.md
 *   6. Optionally inject into CLAUDE.md / SessionStart
 *
 * Usage:
 *   node evolve-instructions.js                    # Dry run, print proposed instructions
 *   node evolve-instructions.js --apply            # Write to evolved-instructions.md
 *   node evolve-instructions.js --apply --inject   # Also inject into SessionStart
 *   node evolve-instructions.js --since 7d         # Only analyze last 7 days
 *
 * Models: gemini-2.5-flash-lite (cheap, fast)
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const dbPath = process.env.MEMORY_DB_PATH || path.join(__dirname, '..', 'memory.db');
const outputPath = path.join(__dirname, '..', 'evolved-instructions.md');
const MODEL = 'gemini-2.5-flash-lite';

// ─── Helpers ───

function geminiCall(prompt) {
    try {
        const escaped = prompt.replace(/'/g, "'\\''");
        const result = execSync(
            `gemini -m ${MODEL} -p '${escaped}'`,
            { timeout: 60000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        return result
            .split('\n')
            .filter(l => !l.match(/^(Created|Expanding|Hook)/))
            .join('\n')
            .trim();
    } catch (e) {
        console.error('Gemini call failed:', e.message?.slice(0, 100));
        return null;
    }
}

function parseSince(sinceStr) {
    const match = sinceStr.match(/^(\d+)([dhm])$/);
    if (!match) return null;
    const [, num, unit] = match;
    const ms = { d: 86400000, h: 3600000, m: 60000 }[unit];
    return new Date(Date.now() - parseInt(num) * ms).toISOString();
}

// ─── Load Cases ───

function loadCases(sinceISO) {
    if (!fs.existsSync(dbPath)) return [];
    const db = new Database(dbPath, { readonly: true });

    let query = `
        SELECT key, value, start_time FROM memories
        WHERE key LIKE 'agent.case.%' AND end_time IS NULL
    `;
    const params = [];
    if (sinceISO) {
        query += ' AND start_time >= ?';
        params.push(sinceISO);
    }
    query += ' ORDER BY start_time DESC LIMIT 500';

    const rows = db.prepare(query).all(...params);
    db.close();

    return rows.map(r => {
        let value;
        try { value = JSON.parse(r.value); } catch { value = { problem: r.value }; }
        return {
            key: r.key,
            problem: typeof value.problem === 'string' ? value.problem : JSON.stringify(value.problem),
            solution: value.solution || {},
            timestamp: r.start_time
        };
    });
}

// ─── Load Existing Instructions ───

function loadExistingInstructions() {
    if (!fs.existsSync(outputPath)) return [];
    const content = fs.readFileSync(outputPath, 'utf8');
    const instructions = [];
    const blocks = content.split(/^## /m).filter(Boolean);
    for (const block of blocks) {
        const lines = block.trim().split('\n');
        const title = lines[0]?.trim();
        const body = lines.slice(1).join('\n').trim();
        if (title) instructions.push({ title, body });
    }
    return instructions;
}

// ─── Cluster Cases ───

function clusterCases(cases) {
    // Simple keyword-based clustering
    const clusters = {};

    for (const c of cases) {
        const problem = (c.problem || '').toLowerCase();
        const actions = (c.solution?.actions || []).join(' ').toLowerCase();
        const combined = problem + ' ' + actions;

        // Extract cluster key from common patterns
        let clusterKey = 'misc';

        if (combined.includes('ssh') && combined.includes('polybot')) clusterKey = 'polybot-ssh';
        else if (combined.includes('permission') || combined.includes('denied')) clusterKey = 'permissions';
        else if (combined.includes('timeout') || combined.includes('timed out')) clusterKey = 'timeout';
        else if (combined.includes('not found') || combined.includes('no such file')) clusterKey = 'file-not-found';
        else if (combined.includes('syntax') || combined.includes('parse error')) clusterKey = 'syntax-error';
        else if (combined.includes('import') || combined.includes('module')) clusterKey = 'module-import';
        else if (combined.includes('git') || combined.includes('commit')) clusterKey = 'git-ops';
        else if (combined.includes('api') || combined.includes('request')) clusterKey = 'api-calls';
        else if (combined.includes('docker') || combined.includes('container')) clusterKey = 'docker';
        else if (combined.includes('npm') || combined.includes('node_modules')) clusterKey = 'npm';
        else if (combined.includes('json') && (combined.includes('parse') || combined.includes('invalid'))) clusterKey = 'json-parse';
        else if (combined.includes('exit code')) clusterKey = 'exit-code';
        else if (combined.includes('sibling tool') || combined.includes('tool_use_error')) clusterKey = 'tool-error';

        if (!clusters[clusterKey]) clusters[clusterKey] = [];
        clusters[clusterKey].push(c);
    }

    return clusters;
}

// ─── Synthesize Instruction from Cluster ───

function synthesizeInstruction(clusterKey, cases) {
    // Prepare a sample of cases (max 10)
    const sample = cases.slice(0, 10);
    const caseSummaries = sample.map((c, i) => {
        const actions = c.solution?.actions?.slice(0, 3)?.join('; ') || 'N/A';
        return `Case ${i + 1}: Problem="${c.problem?.slice(0, 100)}" → Solution="${actions?.slice(0, 150)}"`;
    }).join('\n');

    const prompt = `You are analyzing ${cases.length} agent error cases in the "${clusterKey}" category.

Here are representative cases:
${caseSummaries}

Based on these patterns, write ONE concise behavioral instruction (1-3 sentences) that would prevent these errors in the future.

Rules:
- Be specific and actionable (not vague like "be careful")
- Reference concrete tools, commands, or checks
- If the pattern is too generic to derive a useful instruction, respond with "SKIP"
- Write in English
- Do NOT use markdown formatting, just plain text

Output ONLY the instruction text, nothing else.`;

    return geminiCall(prompt);
}

// ─── Score Novelty ───

function isNovel(instruction, existing) {
    if (!instruction || instruction === 'SKIP') return false;
    const instrLower = instruction.toLowerCase();

    for (const ex of existing) {
        const exLower = (ex.title + ' ' + ex.body).toLowerCase();
        // Simple overlap check
        const instrWords = new Set(instrLower.split(/\s+/).filter(w => w.length > 4));
        const exWords = new Set(exLower.split(/\s+/).filter(w => w.length > 4));
        const overlap = [...instrWords].filter(w => exWords.has(w)).length;
        const similarity = overlap / Math.max(instrWords.size, 1);
        if (similarity > 0.5) return false;
    }
    return true;
}

// ─── Write Output ───

function writeInstructions(instructions) {
    const header = `# Evolved Instructions

Auto-generated behavioral instructions from agent case analysis.
Last updated: ${new Date().toISOString().split('T')[0]}

---

`;
    const body = instructions.map(i =>
        `## ${i.title}\n\n${i.body}\n\n_Evidence: ${i.evidence} cases | Confidence: ${i.confidence} | Generated: ${i.date}_\n`
    ).join('\n');

    fs.writeFileSync(outputPath, header + body);
    console.error(`Wrote ${instructions.length} instructions to ${outputPath}`);
}

// ─── Store to DB ───

function storeEvolution(instructions) {
    if (instructions.length === 0) return;
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 10000');
    const now = new Date().toISOString();

    const closeOld = db.prepare(`
        UPDATE memories SET end_time = ? WHERE key = ? AND end_time IS NULL
    `);
    const insert = db.prepare(`
        INSERT INTO memories (key, value, source, start_time, end_time)
        VALUES (?, ?, ?, ?, NULL)
    `);

    const transaction = db.transaction(() => {
        for (const i of instructions) {
            const key = `agent.evolution.instruction.${i.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`;
            closeOld.run(now, key);
            insert.run(key, JSON.stringify({
                instruction: i.body,
                evidence: i.evidence,
                confidence: i.confidence,
                cluster: i.title,
                generated: i.date
            }), 'auto:self-evolution', now);
        }
    });

    transaction();
    db.close();
    console.error(`Stored ${instructions.length} evolution records to DB`);
}

// ─── Main ───

function main() {
    const args = process.argv.slice(2);
    const applyMode = args.includes('--apply');
    const injectMode = args.includes('--inject');
    const sinceIdx = args.indexOf('--since');
    const sinceStr = sinceIdx !== -1 ? args[sinceIdx + 1] : '30d';
    const sinceISO = parseSince(sinceStr);

    console.error(`=== Self-Evolution Agent ===`);
    console.error(`Analyzing cases since: ${sinceStr} (${sinceISO?.split('T')[0] || 'all'})`);

    // 1. Load
    const cases = loadCases(sinceISO);
    console.error(`Loaded ${cases.length} cases`);
    if (cases.length < 5) {
        console.error('Not enough cases for evolution. Need at least 5.');
        process.exit(0);
    }

    // 2. Cluster
    const clusters = clusterCases(cases);
    const significantClusters = Object.entries(clusters)
        .filter(([key, cases]) => cases.length >= 3 && key !== 'misc')
        .sort((a, b) => b[1].length - a[1].length);

    console.error(`Found ${significantClusters.length} significant clusters:`);
    significantClusters.forEach(([key, c]) => console.error(`  ${key}: ${c.length} cases`));

    // 3. Load existing
    const existing = loadExistingInstructions();
    console.error(`Existing instructions: ${existing.length}`);

    // 4. Synthesize
    const newInstructions = [];
    for (const [clusterKey, clusterCases] of significantClusters) {
        console.error(`\nSynthesizing for "${clusterKey}" (${clusterCases.length} cases)...`);
        const instruction = synthesizeInstruction(clusterKey, clusterCases);

        if (!instruction || instruction === 'SKIP') {
            console.error(`  Skipped (not actionable)`);
            continue;
        }

        if (!isNovel(instruction, existing)) {
            console.error(`  Skipped (overlaps with existing)`);
            continue;
        }

        const confidence = clusterCases.length >= 20 ? 'high' :
                          clusterCases.length >= 10 ? 'medium' : 'low';

        const entry = {
            title: clusterKey,
            body: instruction,
            evidence: clusterCases.length,
            confidence,
            date: new Date().toISOString().split('T')[0]
        };

        newInstructions.push(entry);
        console.error(`  ✓ Generated: "${instruction.slice(0, 80)}..."`);
    }

    // 5. Output
    console.log(JSON.stringify(newInstructions, null, 2));

    if (applyMode && newInstructions.length > 0) {
        const allInstructions = [...existing.map(e => ({
            title: e.title,
            body: e.body,
            evidence: 0,
            confidence: 'inherited',
            date: 'previous'
        })), ...newInstructions];

        writeInstructions(allInstructions);
        storeEvolution(newInstructions);
    }

    if (injectMode && newInstructions.length > 0) {
        injectToSessionStart(newInstructions);
    }

    console.error(`\n=== Done: ${newInstructions.length} new instructions ===`);
}

// ─── Inject to SessionStart ───

function injectToSessionStart(instructions) {
    // Write to a file that query-memory.js can read during SessionStart
    const injectPath = path.join(__dirname, '..', 'evolved-inject.json');
    const payload = instructions.map(i => ({
        instruction: i.body,
        cluster: i.title,
        confidence: i.confidence
    }));
    fs.writeFileSync(injectPath, JSON.stringify(payload, null, 2));
    console.error(`Wrote ${instructions.length} instructions to ${injectPath} for SessionStart injection`);
}

main();
