/**
 * Dedup Decision - Skip/Create/Merge decision using vector similarity + LLM.
 *
 * Usage: const { dedupDecision } = require('./dedup-decision.js');
 */

const { embedTexts, cosineSimilarity } = require('./embed.js');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'digest-config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { dedup: { enabled: false } }; }
}

async function findSimilar(db, candidateVec, threshold, maxCount) {
  const rows = db.prepare(`
    SELECT key, value, embedding FROM memories
    WHERE embedding IS NOT NULL AND end_time IS NULL
  `).all();

  const scored = [];
  for (const r of rows) {
    if (!r.embedding) continue;
    const emb = new Float32Array(
      r.embedding.buffer,
      r.embedding.byteOffset,
      r.embedding.byteLength / 4
    );
    const sim = cosineSimilarity(candidateVec, emb);
    if (sim >= threshold) {
      scored.push({ key: r.key, value: r.value, similarity: sim });
    }
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, maxCount);
}

function callGeminiForDedup(prompt) {
  const result = spawnSync('gemini', ['-p', prompt, '-m', 'gemini-2.5-flash-lite'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GEMINI_SKIP_HOOKS: '1',
      GEMINI_CONFIG_DIR: '/tmp/gemini-null-' + Date.now()
    },
    timeout: 30000,
  });

  if (result.status !== 0) {
    return { action: 'create', reason: 'LLM call failed' };
  }

  let output = (result.stdout || '').trim();
  const first = output.indexOf('{');
  const last = output.lastIndexOf('}');

  if (first !== -1 && last > first) {
    try {
      return JSON.parse(output.slice(first, last + 1));
    } catch {
      return { action: 'create', reason: 'JSON parse failed' };
    }
  }
  return { action: 'create', reason: 'No JSON in response' };
}

/**
 * Make dedup decision for a candidate fact.
 * @param {Object} candidate - { key, value, source }
 * @param {Database} db - better-sqlite3 database instance
 * @returns {Promise<Object>} - { action: 'skip'|'create'|'merge', target?, reason?, candidate, similar? }
 */
async function dedupDecision(candidate, db) {
  const config = loadConfig();

  // If dedup disabled, always create
  if (!config.dedup?.enabled) {
    return { action: 'create', candidate, reason: 'dedup disabled' };
  }

  const threshold = config.dedup.similarity_threshold || 0.85;
  const maxCandidates = config.dedup.max_candidates || 5;

  // 1. Embed candidate
  let candidateVec;
  try {
    [candidateVec] = await embedTexts([`${candidate.key}: ${candidate.value}`]);
  } catch (err) {
    console.error('Embedding failed:', err.message);
    return { action: 'create', candidate, reason: 'embed failed' };
  }

  // 2. Find similar memories
  const similar = await findSimilar(db, candidateVec, threshold, maxCandidates);

  if (similar.length === 0) {
    return { action: 'create', candidate, reason: 'no similar facts' };
  }

  // 3. LLM decision
  const prompt = `Compare this new fact with existing similar facts:

NEW: ${candidate.key} = ${candidate.value}

EXISTING:
${similar.map(s => `- ${s.key} = ${s.value} (similarity: ${s.similarity.toFixed(3)})`).join('\n')}

Decide:
- "skip" if NEW is redundant (same info exists)
- "merge" if NEW should update an existing fact (specify which key)
- "create" if NEW is genuinely new info

Output JSON only: { "action": "skip|merge|create", "target": "key to merge into or null", "reason": "brief reason" }`;

  const decision = callGeminiForDedup(prompt);
  return { ...decision, candidate, similar };
}

module.exports = { dedupDecision, findSimilar };
