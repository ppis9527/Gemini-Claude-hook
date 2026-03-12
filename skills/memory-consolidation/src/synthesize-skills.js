#!/usr/bin/env node
/**
 * Synthesize skills from instincts.
 *
 * Reads high-confidence instincts grouped by domain prefix, calls Gemini to
 * generate SKILL.md files, and records synthesis metadata in memory.db.
 *
 * Usage:
 *   node synthesize-skills.js [--dry-run] [--min-count 3] [--min-confidence 0.6]
 *   node synthesize-skills.js --patch          # patch existing skills with new instincts
 *
 * Key pattern: skill.synthesized.<name>
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const dbPath = process.env.MEMORY_DB_PATH || path.join(__dirname, '..', 'memory.db');
const SKILLS_ROOT = path.join(require('os').homedir(), '.openclaw/workspace/skills');

const GEMINI_MODEL = 'gemini-2.0-flash-lite';
const API_TIMEOUT = 45000;

// Category mapping: instinct domain -> skill directory
const CATEGORY_MAP = {
    error: 'debugging',
    workflow: 'workflow',
    tool: 'tool-usage',
    coding: 'coding',
    testing: 'testing',
};

// ── Auth ─────────────────────────────────────────────────────────────────────

let cachedApiKey = null;

function getApiKey() {
    if (process.env.GOOGLE_API_KEY2) return process.env.GOOGLE_API_KEY2;
    if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
    if (cachedApiKey) return cachedApiKey;
    try {
        const key = execSync(
            'gcloud secrets versions access latest --secret="OPENCLAW_API_GOOGLE2" 2>/dev/null',
            { encoding: 'utf8', timeout: 10000 }
        ).trim();
        if (key) { cachedApiKey = key; return key; }
    } catch {}
    try {
        const key = execSync(
            'gcloud secrets versions access latest --secret="OPENCLAW_API_GOOGLE" 2>/dev/null',
            { encoding: 'utf8', timeout: 10000 }
        ).trim();
        if (key) { cachedApiKey = key; return key; }
    } catch {}
    return null;
}

// ── Gemini API ───────────────────────────────────────────────────────────────

async function callGemini(prompt) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('No Gemini API key available');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.3 },
    });

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Gemini API timeout')), API_TIMEOUT);

        const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                clearTimeout(timer);
                try {
                    const json = JSON.parse(data);
                    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    if (!text) reject(new Error('Empty Gemini response'));
                    else resolve(text);
                } catch (e) {
                    reject(new Error(`Gemini parse error: ${e.message}`));
                }
            });
        });

        req.on('error', (e) => { clearTimeout(timer); reject(e); });
        req.write(body);
        req.end();
    });
}

// ── DB helpers ───────────────────────────────────────────────────────────────

function openDb(readonly = false) {
    const db = new Database(dbPath, { readonly });
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 10000');
    return db;
}

/**
 * Load all active instincts from DB.
 */
function loadActiveInstincts() {
    if (!fs.existsSync(dbPath)) return [];
    const db = openDb(true);
    const rows = db.prepare(`
        SELECT key, value, start_time, source FROM memories
        WHERE key LIKE 'agent.instinct.%' AND end_time IS NULL
        ORDER BY start_time DESC
    `).all();
    db.close();

    return rows.map(r => {
        let parsed;
        try { parsed = JSON.parse(r.value); } catch { parsed = { raw: r.value }; }
        return { key: r.key, value: parsed, start_time: r.start_time, source: r.source };
    });
}

/**
 * Load existing synthesized skill records.
 */
function loadExistingSkills() {
    if (!fs.existsSync(dbPath)) return [];
    const db = openDb(true);
    const rows = db.prepare(`
        SELECT key, value, start_time FROM memories
        WHERE key LIKE 'skill.synthesized.%' AND end_time IS NULL
    `).all();
    db.close();

    return rows.map(r => {
        let parsed;
        try { parsed = JSON.parse(r.value); } catch { parsed = {}; }
        return { key: r.key, value: parsed, start_time: r.start_time };
    });
}

// ── Grouping & filtering ─────────────────────────────────────────────────────

/**
 * Group instincts by first 3 key segments (e.g. agent.instinct.error).
 */
function groupInstincts(instincts) {
    const groups = {};
    for (const inst of instincts) {
        const parts = inst.key.split('.');
        const prefix = parts.slice(0, 3).join('.');
        if (!groups[prefix]) groups[prefix] = [];
        groups[prefix].push(inst);
    }
    return groups;
}

/**
 * Filter groups eligible for synthesis.
 */
function filterEligibleGroups(groups, existingSkillKeys, minCount, minConfidence) {
    const eligible = {};

    for (const [prefix, instincts] of Object.entries(groups)) {
        // Check count
        if (instincts.length < minCount) continue;

        // Check avg confidence
        const avgConfidence = instincts.reduce((sum, i) => sum + (i.value.confidence || 0), 0) / instincts.length;
        if (avgConfidence < minConfidence) continue;

        // Check distinct dates (proxy for distinct sessions)
        const distinctDates = new Set(
            instincts.map(i => (i.start_time || '').substring(0, 10))
        );
        if (distinctDates.size < 2) continue;

        // Check no existing synthesized skill
        const domain = prefix.split('.')[2] || 'general';
        const skillKey = `skill.synthesized.${domain}`;
        if (existingSkillKeys.has(skillKey)) continue;

        eligible[prefix] = { instincts, avgConfidence, distinctDates: distinctDates.size };
    }

    return eligible;
}

// ── SKILL.md generation ──────────────────────────────────────────────────────

function buildSynthesisPrompt(prefix, instincts) {
    const domain = prefix.split('.')[2] || 'general';
    const instinctsJson = JSON.stringify(instincts.map(i => ({
        key: i.key,
        trigger: i.value.trigger,
        action: i.value.action,
        confidence: i.value.confidence,
        evidence_count: i.value.evidence_count,
        common_tools: i.value.common_tools,
    })), null, 2);

    return `You are a skill documentation generator. Given these learned behavioral instincts (auto-extracted from agent sessions), synthesize them into a single cohesive SKILL.md document.

Domain: ${domain}
Instincts:
${instinctsJson}

Generate a SKILL.md with:
1. YAML frontmatter (between --- delimiters) with fields: name, domain, version (1.0.0), confidence (avg), source_count, generated_at (today ISO)
2. A "## When to Apply" section describing triggers
3. A "## Actions" section with concrete numbered steps
4. A "## Common Tools" section if tools are mentioned
5. A "## Evidence" section summarizing the evidence count

Output ONLY the SKILL.md content (starting with ---). No extra commentary.`;
}

function buildPatchPrompt(existingSkillMd, newInstincts) {
    const instinctsJson = JSON.stringify(newInstincts.map(i => ({
        key: i.key,
        trigger: i.value.trigger,
        action: i.value.action,
        confidence: i.value.confidence,
        evidence_count: i.value.evidence_count,
    })), null, 2);

    return `You are updating an existing SKILL.md with new learned instincts.

EXISTING SKILL.md:
${existingSkillMd}

NEW INSTINCTS to incorporate:
${instinctsJson}

Rules:
1. Merge new information into existing sections
2. Bump the version in frontmatter (minor bump, e.g. 1.0.0 → 1.1.0)
3. Update confidence to reflect new evidence
4. Update generated_at to today's ISO date
5. Do NOT remove existing content, only add/update

Output ONLY the updated SKILL.md content (starting with ---). No extra commentary.`;
}

/**
 * Write SKILL.md to disk.
 */
function writeSkillFile(domain, content) {
    const category = CATEGORY_MAP[domain] || domain;
    const skillDir = path.join(SKILLS_ROOT, category, `${domain}-instinct`);

    if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
    }

    const skillPath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(skillPath, content, 'utf8');
    return skillPath;
}

/**
 * Record synthesis in DB.
 */
function recordSynthesis(domain, sourceInstincts, version, skillPath) {
    const db = openDb();
    const now = new Date().toISOString();
    const skillKey = `skill.synthesized.${domain}`;

    // Close old record if exists
    db.prepare(`
        UPDATE memories SET end_time = ? WHERE key = ? AND end_time IS NULL
    `).run(now, skillKey);

    // Insert new record
    db.prepare(`
        INSERT INTO memories (key, value, source, start_time, end_time)
        VALUES (?, ?, ?, ?, NULL)
    `).run(
        skillKey,
        JSON.stringify({
            domain,
            version,
            skill_path: skillPath,
            source_instincts: sourceInstincts.map(i => i.key),
            instinct_count: sourceInstincts.length,
            created_at: now,
        }),
        'auto:skill-synthesis',
        now
    );

    db.close();
}

// ── Main synthesis flow ──────────────────────────────────────────────────────

async function synthesize({ dryRun = false, minCount = 3, minConfidence = 0.6 }) {
    const instincts = loadActiveInstincts();
    console.error(`Loaded ${instincts.length} active instincts`);

    if (instincts.length === 0) {
        console.error('No instincts to synthesize');
        return { synthesized: 0, skipped: 0 };
    }

    const groups = groupInstincts(instincts);
    const existingSkills = loadExistingSkills();
    const existingSkillKeys = new Set(existingSkills.map(s => s.key));

    const eligible = filterEligibleGroups(groups, existingSkillKeys, minCount, minConfidence);
    const eligibleCount = Object.keys(eligible).length;

    console.error(`Found ${Object.keys(groups).length} groups, ${eligibleCount} eligible for synthesis`);

    if (eligibleCount === 0) {
        return { synthesized: 0, skipped: Object.keys(groups).length };
    }

    let synthesized = 0;

    for (const [prefix, { instincts: groupInstincts, avgConfidence }] of Object.entries(eligible)) {
        const domain = prefix.split('.')[2] || 'general';
        console.error(`Synthesizing skill for domain: ${domain} (${groupInstincts.length} instincts, avg confidence: ${avgConfidence.toFixed(2)})`);

        if (dryRun) {
            console.log(`[DRY RUN] Would synthesize: ${domain} from ${groupInstincts.length} instincts`);
            synthesized++;
            continue;
        }

        try {
            const prompt = buildSynthesisPrompt(prefix, groupInstincts);
            const skillContent = await callGemini(prompt);

            const skillPath = writeSkillFile(domain, skillContent);
            recordSynthesis(domain, groupInstincts, '1.0.0', skillPath);

            console.error(`  Written: ${skillPath}`);
            synthesized++;
        } catch (err) {
            console.error(`  Failed to synthesize ${domain}: ${err.message}`);
        }
    }

    return { synthesized, skipped: Object.keys(groups).length - eligibleCount };
}

// ── Patch flow (B2) ──────────────────────────────────────────────────────────

async function patchExistingSkills({ dryRun = false }) {
    const existingSkills = loadExistingSkills();
    if (existingSkills.length === 0) {
        console.error('No existing synthesized skills to patch');
        return { patched: 0 };
    }

    const instincts = loadActiveInstincts();
    let patched = 0;

    for (const skill of existingSkills) {
        const domain = skill.value.domain;
        if (!domain) continue;

        const skillCreatedAt = skill.value.created_at || skill.start_time;
        const prefix = `agent.instinct.${domain}`;

        // Find new instincts (newer than skill creation)
        const newInstincts = instincts.filter(i =>
            i.key.startsWith(prefix) && i.start_time > skillCreatedAt
        );

        if (newInstincts.length === 0) continue;

        console.error(`Patching ${domain}: ${newInstincts.length} new instinct(s) since ${skillCreatedAt}`);

        if (dryRun) {
            console.log(`[DRY RUN] Would patch: ${domain} with ${newInstincts.length} new instinct(s)`);
            patched++;
            continue;
        }

        try {
            // Read existing SKILL.md
            const skillPath = skill.value.skill_path;
            let existingContent = '';
            if (skillPath && fs.existsSync(skillPath)) {
                existingContent = fs.readFileSync(skillPath, 'utf8');
            }

            if (!existingContent) {
                console.error(`  Skill file not found at ${skillPath}, skipping patch`);
                continue;
            }

            // Version bump: 1.0.0 -> 1.1.0
            const oldVersion = skill.value.version || '1.0.0';
            const vParts = oldVersion.split('.').map(Number);
            vParts[1] += 1;
            const newVersion = vParts.join('.');

            const prompt = buildPatchPrompt(existingContent, newInstincts);
            const updatedContent = await callGemini(prompt);

            // Write updated SKILL.md
            fs.writeFileSync(skillPath, updatedContent, 'utf8');

            // Ensure version in SKILL.md matches computed version
            let finalContent = fs.readFileSync(skillPath, 'utf8');
            finalContent = finalContent.replace(/^version:\s*.+$/m, `version: ${newVersion}`);
            fs.writeFileSync(skillPath, finalContent, 'utf8');

            // Collect all source instincts (old + new)
            const allSourceInstincts = [
                ...(skill.value.source_instincts || []).map(k => ({ key: k })),
                ...newInstincts,
            ];
            recordSynthesis(domain, allSourceInstincts, newVersion, skillPath);

            console.error(`  Patched: ${skillPath} (v${oldVersion} → v${newVersion})`);
            patched++;
        } catch (err) {
            console.error(`  Failed to patch ${domain}: ${err.message}`);
        }
    }

    return { patched };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const patchMode = args.includes('--patch');

    const minCountIdx = args.indexOf('--min-count');
    const minCount = minCountIdx !== -1 ? parseInt(args[minCountIdx + 1], 10) : 3;

    const minConfIdx = args.indexOf('--min-confidence');
    const minConfidence = minConfIdx !== -1 ? parseFloat(args[minConfIdx + 1]) : 0.6;

    if (patchMode) {
        const result = await patchExistingSkills({ dryRun });
        console.error(`Patch complete: ${result.patched} skill(s) updated`);
    } else {
        const result = await synthesize({ dryRun, minCount, minConfidence });
        console.error(`Synthesis complete: ${result.synthesized} synthesized, ${result.skipped} skipped`);
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
    });
}

module.exports = { synthesize, patchExistingSkills };
