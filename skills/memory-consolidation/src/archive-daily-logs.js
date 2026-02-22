const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MEMORY_DIR = path.join(process.env.HOME, '.openclaw/agents/main/memory'); // Assuming for Main Agent
const ARCHIVE_DIR = path.join(MEMORY_DIR, 'archive');

// Telegram config - will be set via environment variables in cron
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_TOKEN_MAIN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// --- Helper Functions ---
function padZero(num) {
    return num < 10 ? '0' + num : String(num);
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = padZero(date.getMonth() + 1);
    const day = padZero(date.getDate());
    return `${year}-${month}-${day}`;
}

function getTelegramToken() {
    try {
        // Simulates fetching from GCP Secret Manager via _fetch
        return execSync(`gcloud secrets versions access latest --secret=${process.env.TELEGRAM_TOKEN_MAIN_SECRET_NAME || 'TELEGRAM_TOKEN_MAIN'} 2>/dev/null`, { encoding: 'utf8', timeout: 5000 }).trim();
    } catch (e) {
        console.error("Failed to fetch Telegram token from gcloud secrets:", e.message);
        return process.env.TELEGRAM_TOKEN_MAIN; // Fallback to direct env var
    }
}


async function sendTelegramMessage(message) {
    const token = getTelegramToken(); // Assume TELEGRAM_TOKEN_MAIN_SECRET_NAME is set in cron env
    if (!token || !TELEGRAM_CHAT_ID) {
        console.error('Telegram config missing. Cannot send message.');
        return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
    };

    try {
        const fetch = (await import('node-fetch')).default;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log('Telegram message sent.');
    } catch (error) {
        console.error('Error sending Telegram message:', error.message);
    }
}

// --- Main Logic ---
async function main() {
    console.log('Starting daily log archive and check...');
    let messages = [];
    let warnings = [];

    if (!fs.existsSync(ARCHIVE_DIR)) {
        fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    }

    // --- 1. Check for missing logs for the last 2 days ---
    const today = new Date();
    for (let i = 0; i < 2; i++) { // Check today and yesterday
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const fileName = `${formatDate(date)}.md`;
        const filePath = path.join(MEMORY_DIR, fileName);

        if (!fs.existsSync(filePath)) {
            warnings.push(`⚠️ Missing daily log: `${fileName}` in `${MEMORY_DIR}`. Agent might not have recorded actions.`);
        }
    }

    // --- 2. Archive 2-day old logs ---
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(today.getDate() - 2);
    const archiveFileName = `${formatDate(twoDaysAgo)}.md`;
    const archiveFilePath = path.join(MEMORY_DIR, archiveFileName);
    const destinationPath = path.join(ARCHIVE_DIR, archiveFileName);

    if (fs.existsSync(archiveFilePath)) {
        try {
            fs.renameSync(archiveFilePath, destinationPath);
            messages.push(`✅ Archived daily log: `${archiveFileName}` to `${ARCHIVE_DIR}`.`);
        } catch (error) {
            messages.push(`❌ Failed to archive `${archiveFileName}`: ${error.message}`);
        }
    } else {
        messages.push(`ℹ️ No log found to archive for `${archiveFileName}`.`);
    }

    // --- Compile and Send Report ---
    let report = `🧠 *Daily Memory Log Report - ${formatDate(today)}*

`;
    if (warnings.length > 0) {
        report += warnings.join('
') + '

';
    }
    report += messages.join('
');

    await sendTelegramMessage(report);
    console.log('Daily log archive and check complete.');
}

main().catch(console.error);