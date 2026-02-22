const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath     = process.env.MEMORY_DB_PATH     || path.join(__dirname, '..', 'memory.db');
const digestPath = process.env.MEMORY_DIGEST_PATH || path.join(__dirname, '..', 'memory_digest.json');

function generateDigest() {
    if (!fs.existsSync(dbPath)) {
        console.error(`DB not found: ${dbPath}`);
        process.exit(1);
    }

    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare(`
        SELECT key, value, start_time
        FROM memories
        WHERE end_time IS NULL
        ORDER BY start_time DESC
    `).all();
    db.close();

    const categories = {};
    for (const row of rows) {
        const prefix = row.key.split('.')[0];
        if (!categories[prefix]) categories[prefix] = { count: 0, facts: {} };
        categories[prefix].count++;
        // Include up to 3 facts per category in the L0 digest
        if (Object.keys(categories[prefix].facts).length < 3) {
            try {
                categories[prefix].facts[row.key] = JSON.parse(row.value);
            } catch {
                categories[prefix].facts[row.key] = row.value;
            }
        }
    }

    const categorySummaries = Object.entries(categories)
        .map(([k, v]) => `${v.count} ${k} fact${v.count !== 1 ? 's' : ''}`)
        .join(', ');

    const digest = {
        generated_at: new Date().toISOString(),
        total_facts: rows.length,
        summary: categorySummaries || 'No facts stored yet.',
        categories,
    };

    fs.writeFileSync(digestPath, JSON.stringify(digest, null, 2));
    console.log(`Digest: ${rows.length} facts across ${Object.keys(categories).length} categories.`);
}

generateDigest();
