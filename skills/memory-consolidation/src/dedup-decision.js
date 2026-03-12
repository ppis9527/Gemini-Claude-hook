/**
 * Dedup Decision - Skip/Create/Merge decision using vector similarity + LLM.
 * Uses Gemma 3 4B API (via OPENCLAW_API_GOOGLE2) to avoid creating fake sessions.
 *
 * Usage: const { dedupDecision } = require('./dedup-decision.js');
 */

const { embedTexts, cosineSimilarity } = require('./embed.js');
const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'digest-config.json');
const GEMMA_MODEL = 'gemma-3-4b-it';
const API_TIMEOUT = 30000;
let cachedApiKey = null;

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { dedup: { enabled: false } }; }
}

function getApiKey() {
  // Priority: GOOGLE_API_KEY2 > Secret Manager (KEY2)
  if (process.env.GOOGLE_API_KEY2) return process.env.GOOGLE_API_KEY2;
  if (cachedApiKey) return cachedApiKey;
  try {
    const key = execSync('gcloud secrets versions access latest --secret="OPENCLAW_API_GOOGLE2" 2>/dev/null', {
      encoding: 'utf8', timeout: 10000
    }).trim();
    if (key) { cachedApiKey = key; return key; }
  } catch {}
  return null;
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

/**
 * Call Gemma 3 4B via Google AI REST API. No fake sessions created.
 */
async function callGemmaForDedup(prompt) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { action: 'create', reason: 'API key not available' };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMMA_MODEL}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 100, temperature: 0.1 },
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ action: 'create', reason: 'API timeout' });
    }, API_TIMEOUT);

    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const json = JSON.parse(data);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const first = text.indexOf('{');
          const last = text.lastIndexOf('}');
          if (first !== -1 && last > first) {
            resolve(JSON.parse(text.slice(first, last + 1)));
          } else {
            resolve({ action: 'create', reason: 'No JSON in response' });
          }
        } catch {
          resolve({ action: 'create', reason: 'JSON parse failed' });
        }
      });
    });

    req.on('error', () => {
      clearTimeout(timer);
      resolve({ action: 'create', reason: 'API request failed' });
    });

    req.write(body);
    req.end();
  });
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

  // 3. LLM decision via Gemma API (no fake sessions)
  const prompt = `Compare this new fact with existing similar facts:

NEW: ${candidate.key} = ${candidate.value}

EXISTING:
${similar.map(s => `- ${s.key} = ${s.value} (similarity: ${s.similarity.toFixed(3)})`).join('\n')}

Decide:
- "skip" if NEW is redundant (same info exists)
- "merge" if NEW should update an existing fact (specify which key)
- "create" if NEW is genuinely new info

Output JSON only: { "action": "skip|merge|create", "target": "key to merge into or null", "reason": "brief reason" }`;

  const decision = await callGemmaForDedup(prompt);
  return { ...decision, candidate, similar };
}

module.exports = { dedupDecision, findSimilar };
