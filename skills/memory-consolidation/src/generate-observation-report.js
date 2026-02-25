#!/usr/bin/env node
/**
 * Generate daily observation report
 *
 * Reads observations.jsonl and memory.db patterns,
 * outputs a markdown report.
 *
 * Usage:
 *   node generate-observation-report.js [--date YYYY-MM-DD]
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { execSync } = require('child_process');

const MEMORY_ROOT = path.join(require('os').homedir(), '.openclaw/workspace/skills/memory-consolidation');
const OBSERVATIONS_FILE = path.join(MEMORY_ROOT, 'observations.jsonl');
const DB_PATH = path.join(MEMORY_ROOT, 'memory.db');
const REPORTS_DIR = path.join(MEMORY_ROOT, 'reports', 'observations');
const GDRIVE_FOLDER_ID = '1rQoOFRBngYCElmLFxG4mjD5KyO53uBlU';
const GOG_ACCOUNT = 'jerryyrliu@gmail.com';

const args = process.argv.slice(2);
let targetDate = new Date().toISOString().slice(0, 10);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
        targetDate = args[i + 1];
    }
}

function readObservations() {
    if (!fs.existsSync(OBSERVATIONS_FILE)) return [];

    const lines = fs.readFileSync(OBSERVATIONS_FILE, 'utf8').split('\n').filter(Boolean);
    const observations = [];

    for (const line of lines) {
        try {
            const obs = JSON.parse(line);
            if (obs.timestamp?.startsWith(targetDate)) {
                observations.push(obs);
            }
        } catch {}
    }

    return observations;
}

function getPatterns() {
    if (!fs.existsSync(DB_PATH)) return { patterns: [], instincts: [] };

    const db = new Database(DB_PATH, { readonly: true });

    const patterns = db.prepare(`
        SELECT key, value FROM memories
        WHERE key LIKE 'agent.pattern.%' AND end_time IS NULL
        ORDER BY start_time DESC
        LIMIT 20
    `).all();

    const instincts = db.prepare(`
        SELECT key, value FROM memories
        WHERE key LIKE 'agent.instinct.%' AND end_time IS NULL
        ORDER BY start_time DESC
        LIMIT 20
    `).all();

    db.close();

    const parseValue = (r) => {
        try {
            return { key: r.key, value: JSON.parse(r.value) };
        } catch {
            return { key: r.key, value: { raw: r.value } };
        }
    };

    return {
        patterns: patterns.map(parseValue),
        instincts: instincts.map(parseValue)
    };
}

function analyzeObservations(observations) {
    const toolCounts = {};
    const sessionCounts = {};
    const hourlyActivity = {};

    for (const obs of observations) {
        // Tool frequency
        if (obs.tool) {
            toolCounts[obs.tool] = (toolCounts[obs.tool] || 0) + 1;
        }

        // Session activity
        if (obs.session) {
            sessionCounts[obs.session] = (sessionCounts[obs.session] || 0) + 1;
        }

        // Hourly activity
        if (obs.timestamp) {
            const hour = obs.timestamp.slice(11, 13);
            hourlyActivity[hour] = (hourlyActivity[hour] || 0) + 1;
        }
    }

    return { toolCounts, sessionCounts, hourlyActivity };
}

function generateReport(observations, analysis, patterns, instincts) {
    const lines = [];

    lines.push(`# Observation Report — ${targetDate}`);
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Observations | ${observations.length} |`);
    lines.push(`| Unique Tools | ${Object.keys(analysis.toolCounts).length} |`);
    lines.push(`| Active Sessions | ${Object.keys(analysis.sessionCounts).length} |`);
    lines.push(`| Patterns Detected | ${patterns.length} |`);
    lines.push(`| Instincts Active | ${instincts.length} |`);
    lines.push('');

    // Tool Usage
    lines.push('## Tool Usage');
    lines.push('');
    const sortedTools = Object.entries(analysis.toolCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);

    if (sortedTools.length > 0) {
        lines.push('| Tool | Count |');
        lines.push('|------|-------|');
        for (const [tool, count] of sortedTools) {
            lines.push(`| ${tool} | ${count} |`);
        }
    } else {
        lines.push('No tool usage recorded.');
    }
    lines.push('');

    // Hourly Activity
    lines.push('## Hourly Activity');
    lines.push('');
    const hours = Object.keys(analysis.hourlyActivity).sort();
    if (hours.length > 0) {
        lines.push('```');
        for (const hour of hours) {
            const count = analysis.hourlyActivity[hour];
            const bar = '█'.repeat(Math.min(count, 50));
            lines.push(`${hour}:00 │${bar} ${count}`);
        }
        lines.push('```');
    } else {
        lines.push('No activity recorded.');
    }
    lines.push('');

    // Patterns
    lines.push('## Detected Patterns');
    lines.push('');
    if (patterns.length > 0) {
        for (const p of patterns.slice(0, 10)) {
            const conf = p.value.confidence ? ` (${Math.round(p.value.confidence * 100)}%)` : '';
            lines.push(`- **${p.key}**${conf}`);
            if (p.value.type === 'frequency') {
                lines.push(`  - Tool: ${p.value.tool}, Count: ${p.value.count}`);
            } else if (p.value.type === 'sequence') {
                lines.push(`  - Sequence: ${p.value.sequence}`);
            }
        }
    } else {
        lines.push('No patterns detected yet.');
    }
    lines.push('');

    // Instincts
    lines.push('## Active Instincts');
    lines.push('');
    if (instincts.length > 0) {
        for (const i of instincts.slice(0, 10)) {
            const conf = i.value.confidence ? `${Math.round(i.value.confidence * 100)}%` : 'N/A';
            const domain = i.key.split('.')[2] || 'general';
            lines.push(`- **[${domain}]** ${i.value.trigger || ''} → ${i.value.action || ''} (${conf})`);
        }
    } else {
        lines.push('No instincts learned yet.');
    }
    lines.push('');

    return lines.join('\n');
}

function main() {
    const observations = readObservations();
    const analysis = analyzeObservations(observations);
    const { patterns, instincts } = getPatterns();

    const report = generateReport(observations, analysis, patterns, instincts);

    // Ensure reports directory exists
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    // Write report
    const reportPath = path.join(REPORTS_DIR, `${targetDate}.md`);
    fs.writeFileSync(reportPath, report);

    console.log(`[generate-observation-report] Written to ${reportPath}`);
    console.log(`  - Observations: ${observations.length}`);
    console.log(`  - Tools: ${Object.keys(analysis.toolCounts).length}`);
    console.log(`  - Patterns: ${patterns.length}`);
    console.log(`  - Instincts: ${instincts.length}`);

    // Upload to Google Drive
    if (observations.length > 0) {
        try {
            const gogPassword = execSync(
                'gcloud secrets versions access latest --secret="GOG_KEYRING_PASSWORD"',
                { encoding: 'utf8' }
            ).trim();

            const result = execSync(
                `gog drive upload "${reportPath}" --parent ${GDRIVE_FOLDER_ID} --account ${GOG_ACCOUNT}`,
                { encoding: 'utf8', env: { ...process.env, GOG_KEYRING_PASSWORD: gogPassword } }
            );

            console.log('[generate-observation-report] Uploaded to GDrive');
        } catch (e) {
            console.error('[generate-observation-report] GDrive upload failed:', e.message);
        }
    }
}

main();
