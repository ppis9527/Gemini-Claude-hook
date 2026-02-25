/**
 * Hybrid Search - Combine Vector + BM25 (FTS5) search results
 *
 * Uses Reciprocal Rank Fusion (RRF) to merge results from both methods.
 *
 * Usage:
 *   const { hybridSearch } = require('./hybrid-search.js');
 *   const results = hybridSearch(db, query, queryEmbedding, options);
 */

const { cosineSimilarity } = require('./embed.js');

// RRF constant (standard value)
const RRF_K = 60;

// Minimum similarity threshold for vector search
const VECTOR_THRESHOLD = 0.3;

// BM25 bonus factor (how much to boost FTS5 matches)
const BM25_BONUS = 0.15;

/**
 * Perform hybrid search combining vector similarity and BM25
 * @param {Database} db - SQLite database instance
 * @param {string} query - Search query text
 * @param {Float32Array} queryEmbedding - Query embedding vector
 * @param {Object} options - Search options
 * @param {number} options.limit - Max results (default 50)
 * @param {number} options.vectorWeight - Weight for vector score (default 0.7)
 * @param {number} options.bm25Weight - Weight for BM25 score (default 0.3)
 * @returns {Array} - Merged and ranked results
 */
function hybridSearch(db, query, queryEmbedding, options = {}) {
    const limit = options.limit || 50;
    const vectorWeight = options.vectorWeight ?? 0.7;
    const bm25Weight = options.bm25Weight ?? 0.3;

    // 1. Vector search
    const vectorResults = vectorSearch(db, queryEmbedding, limit * 2);

    // 2. BM25 search (FTS5)
    const bm25Results = bm25Search(db, query, limit * 2);

    // 3. Merge with RRF
    const merged = mergeResults(vectorResults, bm25Results, vectorWeight, bm25Weight);

    // 4. Sort by final score and limit
    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, limit);
}

/**
 * Vector similarity search
 */
function vectorSearch(db, queryEmbedding, limit) {
    const rows = db.prepare(`
        SELECT rowid, key, value, start_time, embedding
        FROM memories
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
        const sim = cosineSimilarity(queryEmbedding, emb);

        if (sim >= VECTOR_THRESHOLD) {
            scored.push({
                rowid: r.rowid,
                key: r.key,
                value: r.value,
                start_time: r.start_time,
                vectorScore: sim,
            });
        }
    }

    // Sort by similarity, return top N
    scored.sort((a, b) => b.vectorScore - a.vectorScore);
    return scored.slice(0, limit);
}

/**
 * BM25 search using FTS5
 */
function bm25Search(db, query, limit) {
    if (!query || query.trim().length === 0) return [];

    // Quote each token to prevent FTS5 syntax errors
    const safeQuery = query
        .split(/\s+/)
        .filter(Boolean)
        .map(t => `"${t.replace(/"/g, '""')}"`)
        .join(' ');

    if (!safeQuery) return [];

    try {
        const rows = db.prepare(`
            SELECT m.rowid, m.key, m.value, m.start_time, bm25(memories_fts) as bm25_score
            FROM memories m
            JOIN memories_fts fts ON m.rowid = fts.rowid
            WHERE memories_fts MATCH ? AND m.end_time IS NULL
            ORDER BY bm25_score
            LIMIT ?
        `).all(safeQuery, limit);

        // Normalize BM25 scores (they are negative, closer to 0 = better)
        // Convert to 0-1 range
        if (rows.length === 0) return [];

        const minScore = Math.min(...rows.map(r => r.bm25_score));
        const maxScore = Math.max(...rows.map(r => r.bm25_score));
        const range = maxScore - minScore || 1;

        return rows.map(r => ({
            rowid: r.rowid,
            key: r.key,
            value: r.value,
            start_time: r.start_time,
            bm25Score: 1 - (r.bm25_score - minScore) / range, // Normalize to 0-1
            bm25Hit: true,
        }));
    } catch (e) {
        // FTS5 query failed (invalid syntax, etc.)
        console.error('BM25 search failed:', e.message);
        return [];
    }
}

/**
 * Merge vector and BM25 results using weighted combination
 */
function mergeResults(vectorResults, bm25Results, vectorWeight, bm25Weight) {
    const resultMap = new Map();

    // Add vector results
    for (const r of vectorResults) {
        resultMap.set(r.rowid, {
            rowid: r.rowid,
            key: r.key,
            value: r.value,
            start_time: r.start_time,
            vectorScore: r.vectorScore,
            bm25Score: 0,
            bm25Hit: false,
        });
    }

    // Merge BM25 results
    for (const r of bm25Results) {
        if (resultMap.has(r.rowid)) {
            // Both methods found this result - boost it
            const existing = resultMap.get(r.rowid);
            existing.bm25Score = r.bm25Score;
            existing.bm25Hit = true;
        } else {
            // BM25 only - add with default vector score
            resultMap.set(r.rowid, {
                rowid: r.rowid,
                key: r.key,
                value: r.value,
                start_time: r.start_time,
                vectorScore: 0.5, // Baseline for BM25-only results
                bm25Score: r.bm25Score,
                bm25Hit: true,
            });
        }
    }

    // Calculate final scores
    const results = [];
    for (const r of resultMap.values()) {
        // Weighted combination + BM25 bonus for hits
        let score = (r.vectorScore * vectorWeight) + (r.bm25Score * bm25Weight);

        // Additional bonus if both methods agree
        if (r.bm25Hit && r.vectorScore > VECTOR_THRESHOLD) {
            score += r.vectorScore * BM25_BONUS;
        }

        results.push({
            key: r.key,
            value: r.value,
            start_time: r.start_time,
            score,
            vectorScore: r.vectorScore,
            bm25Score: r.bm25Score,
            bm25Hit: r.bm25Hit,
        });
    }

    return results;
}

/**
 * Simple RRF merge (alternative method)
 */
function rrfMerge(vectorResults, bm25Results, k = RRF_K) {
    const scoreMap = new Map();

    // Add vector results with RRF score
    vectorResults.forEach((r, rank) => {
        const rrfScore = 1 / (k + rank + 1);
        scoreMap.set(r.rowid, {
            ...r,
            rrfScore,
            sources: ['vector'],
        });
    });

    // Add BM25 results
    bm25Results.forEach((r, rank) => {
        const rrfScore = 1 / (k + rank + 1);
        if (scoreMap.has(r.rowid)) {
            const existing = scoreMap.get(r.rowid);
            existing.rrfScore += rrfScore;
            existing.sources.push('bm25');
        } else {
            scoreMap.set(r.rowid, {
                ...r,
                rrfScore,
                sources: ['bm25'],
            });
        }
    });

    return Array.from(scoreMap.values());
}

module.exports = {
    hybridSearch,
    vectorSearch,
    bm25Search,
    mergeResults,
    rrfMerge,
    VECTOR_THRESHOLD,
    BM25_BONUS,
    RRF_K,
};
