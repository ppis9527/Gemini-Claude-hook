const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs'); // Added fs module

const DB_PATH = process.env.MEMORY_DB_PATH || path.join(__dirname, '..', 'memory.db');

function main() {
    if (!fs.existsSync(DB_PATH)) {
        console.log("Memory DB not found.");
        return;
    }
    const db = new Database(DB_PATH, { readonly: true });
    
    const totalFacts = db.prepare("SELECT count(*) FROM memories;").get()['count(*)'];
    const embeddedFacts = db.prepare("SELECT count(*) FROM memories WHERE embedding IS NOT NULL;").get()['count(*)'];

    db.close();
    console.log(`Total Facts: ${totalFacts}`);
    console.log(`Facts with Embeddings: ${embeddedFacts}`);
}

main();
