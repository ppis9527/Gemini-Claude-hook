#!/usr/bin/env node
/**
 * smart-fetch - Token-efficient web scraping with Playwright
 *
 * Features:
 * - CSS selector extraction
 * - Readability mode (auto-clean)
 * - US proxy support
 * - Multiple output formats
 * - Batch URL processing
 */

const { chromium } = require('playwright');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const TurndownService = require('turndown');
const fs = require('fs');
const path = require('path');

const PROXY_US = 'socks5://136.109.240.186:1080';

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        url: null,
        selector: null,
        readability: false,
        proxy: false,
        wait: 1000,
        format: 'text',
        screenshot: null,
        headed: false,
        batch: false,
        timeout: 30000
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--selector' && args[i + 1]) options.selector = args[++i];
        else if (arg === '--readability') options.readability = true;
        else if (arg === '--proxy') options.proxy = true;
        else if (arg === '--wait' && args[i + 1]) options.wait = parseInt(args[++i], 10);
        else if (arg === '--format' && args[i + 1]) options.format = args[++i];
        else if (arg === '--screenshot' && args[i + 1]) options.screenshot = args[++i];
        else if (arg === '--headed') options.headed = true;
        else if (arg === '--batch') options.batch = true;
        else if (arg === '--timeout' && args[i + 1]) options.timeout = parseInt(args[++i], 10);
        else if (!arg.startsWith('--') && !options.url) options.url = arg;
    }

    return options;
}

async function fetchUrl(browser, url, options) {
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        await page.goto(url, { timeout: options.timeout, waitUntil: 'domcontentloaded' });

        if (options.wait > 0) {
            await page.waitForTimeout(options.wait);
        }

        // Screenshot
        if (options.screenshot) {
            await page.screenshot({ path: options.screenshot, fullPage: true });
        }

        let html;
        if (options.selector) {
            const elements = await page.$$eval(options.selector, els => els.map(e => e.outerHTML));
            html = elements.join('\n');
        } else {
            html = await page.content();
        }

        let result = { url, title: await page.title(), content: '' };

        // Readability mode
        if (options.readability) {
            const dom = new JSDOM(html, { url });
            const reader = new Readability(dom.window.document);
            const article = reader.parse();
            if (article) {
                result.title = article.title;
                html = article.content;
            }
        }

        // Format output
        if (options.format === 'markdown') {
            const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
            result.content = turndown.turndown(html);
        } else if (options.format === 'json') {
            result.html = html;
            result.content = extractText(html);
        } else {
            result.content = extractText(html);
        }

        return result;
    } finally {
        await context.close();
    }
}

function extractText(html) {
    const dom = new JSDOM(html);
    return dom.window.document.body?.textContent?.trim()
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n') || '';
}

async function main() {
    const options = parseArgs();

    if (!options.url) {
        console.error('Usage: smart-fetch <url|file> [options]');
        console.error('Options: --selector, --readability, --proxy, --wait, --format, --screenshot, --headed, --batch, --timeout');
        process.exit(1);
    }

    // Get URLs
    let urls = [];
    if (options.batch && fs.existsSync(options.url)) {
        urls = fs.readFileSync(options.url, 'utf-8')
            .split('\n')
            .map(u => u.trim())
            .filter(u => u && !u.startsWith('#'));
    } else {
        urls = [options.url];
    }

    // Launch browser
    const launchOptions = {
        headless: !options.headed
    };
    if (options.proxy) {
        launchOptions.proxy = { server: PROXY_US };
    }

    const browser = await chromium.launch(launchOptions);

    try {
        const results = [];
        for (const url of urls) {
            try {
                console.error(`Fetching: ${url}`);
                const result = await fetchUrl(browser, url, options);
                results.push(result);
            } catch (err) {
                console.error(`Error fetching ${url}: ${err.message}`);
                results.push({ url, error: err.message });
            }
        }

        // Output
        if (options.format === 'json') {
            console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
        } else {
            for (const r of results) {
                if (r.error) {
                    console.log(`[ERROR] ${r.url}: ${r.error}`);
                } else {
                    if (results.length > 1) console.log(`\n=== ${r.title} (${r.url}) ===\n`);
                    console.log(r.content);
                }
            }
        }
    } finally {
        await browser.close();
    }
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
