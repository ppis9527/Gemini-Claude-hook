/**
 * Gemini embedding utility — zero npm deps.
 *
 * Provides:
 *   embedTexts(texts)        → Float32Array[]
 *   cosineSimilarity(a, b)   → number
 *
 * Auth strategy (priority order):
 *   1. Vertex AI via `gcloud auth print-access-token` (no TPM limit)
 *   2. GOOGLE_API_KEY env var → Gemini API (has TPM limit)
 *   3. GCP Secret Manager (OPENCLAW_API_GOOGLE) → Gemini API (fallback)
 */

const { execSync } = require("child_process");

const EMBED_MODEL = "gemini-embedding-001";
const BATCH_SIZE = 100;

// ── Auth helpers ────────────────────────────────────────────────────────────

let cachedApiKey = null;
let cachedGcloudToken = null;
let gcloudTokenExpiry = 0;

function getGcloudToken() {
  // Cache for 50 minutes (tokens last 60 min)
  if (cachedGcloudToken && Date.now() < gcloudTokenExpiry) {
    return cachedGcloudToken;
  }
  try {
    const token = execSync("gcloud auth print-access-token 2>/dev/null", {
      encoding: "utf8",
      timeout: 15000,
    }).trim();
    if (token) {
      cachedGcloudToken = token;
      gcloudTokenExpiry = Date.now() + 50 * 60 * 1000;
      return token;
    }
  } catch {
    // Fall through
  }
  return null;
}

function getGcloudProject() {
  try {
    return execSync("gcloud config get-value project 2>/dev/null", {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function getApiKey() {
  // Priority: GOOGLE_API_KEY2 > GOOGLE_API_KEY > Secret Manager (KEY2) > Secret Manager (KEY)
  if (process.env.GOOGLE_API_KEY2) return process.env.GOOGLE_API_KEY2;
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  if (cachedApiKey) return cachedApiKey;

  // Try GCP Secret Manager
  for (const secret of ['OPENCLAW_API_GOOGLE2', 'OPENCLAW_API_GOOGLE']) {
    try {
      const key = execSync(
        `gcloud secrets versions access latest --secret=${secret} 2>/dev/null`,
        { encoding: "utf8", timeout: 5000 }
      ).trim();
      if (key) {
        cachedApiKey = key;
        return key;
      }
    } catch {
      // Try next
    }
  }
  return null;
}

// ── Embedding ───────────────────────────────────────────────────────────────

/**
 * Batch-embed an array of strings.
 * @param {string[]} texts
 * @returns {Promise<Float32Array[]>}
 */
async function embedTexts(texts) {
  if (texts.length === 0) return [];

  // Priority 1: Vertex AI (no TPM limit)
  const token = getGcloudToken();
  const project = getGcloudProject();
  if (token && project) {
    return embedViaVertexAi(texts, token, project);
  }

  // Priority 2/3: Gemini API with API key
  const apiKey = getApiKey();
  if (apiKey) {
    return embedViaGeminiApi(texts, apiKey);
  }

  throw new Error(
    "No auth available. Need gcloud login or GOOGLE_API_KEY env var."
  );
}

// Vertex AI — no TPM limit, uses gcloud token
async function embedViaVertexAi(texts, token, project) {
  const region = process.env.VERTEX_REGION || "us-central1";
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${EMBED_MODEL}:predict`;

  const results = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: batch.map((t) => ({ content: t })),
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Vertex AI embedding error: ${res.status} ${await res.text()}`
      );
    }

    const data = await res.json();
    for (const pred of data.predictions) {
      results.push(new Float32Array(pred.embeddings.values));
    }
  }
  return results;
}

// Gemini API — has TPM limit, uses API key
async function embedViaGeminiApi(texts, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${apiKey}`;

  const results = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: batch.map((t) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: t }] },
        })),
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Gemini API embedding error: ${res.status} ${await res.text()}`
      );
    }

    const data = await res.json();
    for (const emb of data.embeddings) {
      results.push(new Float32Array(emb.values));
    }
  }
  return results;
}

// ── Cosine similarity ───────────────────────────────────────────────────────

/**
 * Cosine similarity between two Float32Array vectors.
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number}
 */
function cosineSimilarity(a, b) {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

module.exports = { embedTexts, cosineSimilarity };
