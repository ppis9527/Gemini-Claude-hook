#!/usr/bin/env node
/**
 * report-upload - Upload reports to workspace and GDrive
 *
 * Usage:
 *   report-upload <type> <file>              # Upload file to GDrive folder
 *   report-upload <type> <file> --upsert     # Delete existing + upload
 *   report-upload <type> --title "..." --stdin  # Create from stdin
 *   report-upload --list                     # List supported report types
 *
 * Examples:
 *   report-upload learning 2026-02-25-oom-analysis.md
 *   report-upload decisions --title "Report Upload CLI" --stdin < plan.md
 *   report-upload learning report.md --upsert
 */

const fs = require('fs');
const path = require('path');
const gdrive = require('./lib/gdrive-upload');

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME, '.openclaw/workspace');
const CONFIG_FILE = path.join(WORKSPACE, 'config/report-folders.json');

function loadConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        console.error(`Config not found: ${CONFIG_FILE}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

function listTypes(config) {
    console.log('Supported report types:\n');
    for (const [type, info] of Object.entries(config)) {
        console.log(`  ${type.padEnd(15)} → ${info.localDir}/`);
    }
    console.log('\nUsage: report-upload <type> <file> [--upsert]');
}

function generateFilename(title) {
    const date = new Date().toISOString().split('T')[0];
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return `${date}-${slug}.md`;
}

function extractHashtags(content) {
    const matches = content.match(/#[a-zA-Z][a-zA-Z0-9_-]*/g) || [];
    return [...new Set(matches)];
}

function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('readable', () => {
            let chunk;
            while ((chunk = process.stdin.read()) !== null) {
                data += chunk;
            }
        });
        process.stdin.on('end', () => resolve(data));
    });
}

async function main() {
    const args = process.argv.slice(2);
    const config = loadConfig();

    // Parse flags
    const flags = {
        list: args.includes('--list'),
        upsert: args.includes('--upsert'),
        stdin: args.includes('--stdin'),
        title: null,
        help: args.includes('--help') || args.includes('-h')
    };

    const titleIdx = args.indexOf('--title');
    if (titleIdx !== -1 && args[titleIdx + 1]) {
        flags.title = args[titleIdx + 1];
    }

    // Remove flags from args
    const positional = args.filter(a =>
        !a.startsWith('--') &&
        (titleIdx === -1 || args.indexOf(a) !== titleIdx + 1)
    );

    // --list
    if (flags.list) {
        listTypes(config);
        return;
    }

    // --help
    if (flags.help || positional.length === 0) {
        console.log(`report-upload - Upload reports to workspace and GDrive

Usage:
  report-upload <type> <file>              Upload file
  report-upload <type> <file> --upsert     Delete existing + upload
  report-upload <type> --title "..." --stdin  Create from stdin
  report-upload --list                     List report types

Options:
  --upsert    Delete existing file with same name before uploading
  --stdin     Read content from stdin
  --title     Specify title (used for filename generation)
  --list      List supported report types
  --help      Show this help`);
        return;
    }

    // Get type
    const type = positional[0];
    if (!config[type]) {
        console.error(`Unknown report type: ${type}`);
        console.error(`Use --list to see supported types`);
        process.exit(1);
    }

    const { localDir, gdriveFolderId } = config[type];
    const fullLocalDir = path.join(WORKSPACE, localDir);

    // Ensure local directory exists
    if (!fs.existsSync(fullLocalDir)) {
        fs.mkdirSync(fullLocalDir, { recursive: true });
    }

    let filePath;
    let content;

    if (flags.stdin) {
        // Create from stdin
        if (!flags.title) {
            console.error('--title required when using --stdin');
            process.exit(1);
        }
        content = await readStdin();
        const filename = generateFilename(flags.title);
        filePath = path.join(fullLocalDir, filename);
        fs.writeFileSync(filePath, content);
        console.log(`Created: ${filePath}`);
    } else {
        // Use provided file
        const inputFile = positional[1];
        if (!inputFile) {
            console.error('File path required');
            process.exit(1);
        }

        // Check if input is a path or just a filename
        let srcPath = inputFile;
        if (!path.isAbsolute(inputFile) && !fs.existsSync(inputFile)) {
            // Try in current directory
            srcPath = path.join(process.cwd(), inputFile);
        }

        if (!fs.existsSync(srcPath)) {
            console.error(`File not found: ${srcPath}`);
            process.exit(1);
        }

        content = fs.readFileSync(srcPath, 'utf8');

        // Copy to workspace if not already there
        const filename = path.basename(srcPath);
        filePath = path.join(fullLocalDir, filename);

        if (srcPath !== filePath) {
            fs.copyFileSync(srcPath, filePath);
            console.log(`Copied to: ${filePath}`);
        }
    }

    // Extract hashtags for info
    const hashtags = extractHashtags(content);
    if (hashtags.length > 0) {
        console.log(`Hashtags: ${hashtags.join(' ')}`);
    }

    // Upload to GDrive
    console.log(`Uploading to GDrive (${type})...`);
    let link;
    if (flags.upsert) {
        link = gdrive.upsert(filePath, gdriveFolderId);
    } else {
        link = gdrive.upload(filePath, gdriveFolderId);
    }

    if (link) {
        console.log(`✓ Uploaded: ${link}`);
    } else {
        console.error('Upload failed');
        process.exit(1);
    }
}

main().catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
});
