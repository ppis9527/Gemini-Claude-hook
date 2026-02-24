const https = require('https');
const { execSync } = require('child_process');

/**
 * Notion Sync Utility v2.1
 * Standardized interface for OpenClaw Tasks & Reports
 */

// Fetch API key from environment or gcloud secrets
function getApiKey() {
    if (process.env.NOTION_API_KEY) {
        return process.env.NOTION_API_KEY;
    }
    try {
        return execSync('gcloud secrets versions access latest --secret=NOTION_OPENCLAW_KEY', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
    } catch (e) {
        return null;
    }
}

const CONFIG = {
    apiKey: getApiKey(),
    databaseId: '77fd1ee5-8c4d-4538-87f6-22f4d2688148',
    version: '2022-06-28'
};

function callNotion(path, method, data) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.notion.com',
            path: '/v1' + path,
            method: method,
            headers: {
                'Authorization': `Bearer ${CONFIG.apiKey}`,
                'Notion-Version': CONFIG.version,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                const response = JSON.parse(body);
                if (res.statusCode >= 400) reject(response);
                else resolve(response);
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

const action = process.argv[2]; // 'report', 'task', or 'query'
const title = process.argv[3];
const agent = process.argv[4] || 'Gemini';

// Helper to extract text from Notion rich_text
function getText(richText) {
    if (!richText || !Array.isArray(richText)) return '';
    return richText.map(t => t.plain_text || t.text?.content || '').join('');
}

// Helper to format task for display
function formatTask(page) {
    const props = page.properties;
    const name = getText(props.Name?.title);
    const type = props.Type?.select?.name || '-';
    const status = props.Status?.select?.name || '-';
    const priority = props.Priority?.select?.name || '-';
    const agent = props.Agent?.select?.name || '-';
    const desc = getText(props['Task Description']?.rich_text) || '';

    return { name, type, status, priority, agent, desc, url: page.url };
}

async function main() {
    if (!CONFIG.apiKey) {
        console.error('Error: NOTION_API_KEY not found. Set env var or ensure gcloud secrets access.');
        process.exit(1);
    }

    try {
        if (action === 'query') {
            // Query tasks with optional status filter
            const statusFilter = process.argv[3]; // e.g., "進行中", "未開始", "已完成"
            const typeFilter = process.argv[4]; // e.g., "Task", "Report"

            const filter = { and: [] };

            if (statusFilter) {
                filter.and.push({
                    property: 'Status',
                    select: { equals: statusFilter }
                });
            }

            if (typeFilter) {
                filter.and.push({
                    property: 'Type',
                    select: { equals: typeFilter }
                });
            }

            const payload = filter.and.length > 0 ? { filter } : {};

            const result = await callNotion(`/databases/${CONFIG.databaseId}/query`, 'POST', payload);

            if (result.results.length === 0) {
                console.log('📭 沒有找到符合條件的項目');
                return;
            }

            console.log(`📋 找到 ${result.results.length} 個項目:\n`);

            result.results.forEach((page, i) => {
                const t = formatTask(page);
                console.log(`${i + 1}. **${t.name}**`);
                console.log(`   狀態: ${t.status} | 優先: ${t.priority} | Agent: ${t.agent}`);
                if (t.desc) console.log(`   描述: ${t.desc.substring(0, 100)}${t.desc.length > 100 ? '...' : ''}`);
                console.log(`   🔗 ${t.url}\n`);
            });

        } else if (action === 'report') {
            const result = await callNotion('/pages', 'POST', {
                parent: { database_id: CONFIG.databaseId },
                properties: {
                    'Name': { title: [{ text: { content: title } }] },
                    'Type': { select: { name: 'Report' } },
                    'Agent': { select: { name: agent } }
                }
            });
            console.log(`✅ Report synced: ${result.url}`);
        } else if (action === 'task') {
            const priority = process.argv[5] || 'Medium';
            const status = process.argv[6] || '進行中'; // New: status argument
            const taskDescription = process.argv[7] || ''; // New: Task Description property
            const progressJson = process.argv[8] || '[]'; // Original 'content', now for children blocks
            
            const notionBlocks = JSON.parse(progressJson).map(item => ({
                object: 'block',
                type: 'bulleted_list_item',
                bulleted_list_item: {
                    rich_text: [{
                        type: 'text',
                        text: {
                            content: item
                        }
                    }]
                }
            }));

            const payload = {
                parent: { database_id: CONFIG.databaseId },
                properties: {
                    'Name': { title: [{ text: { content: title } }] },
                    'Type': { select: { name: 'Task' } },
                    'Agent': { select: { name: agent } },
                    'Priority': { select: { name: priority } },
                    'Status': { select: { name: status } }, // New: Status property
                    'Task Description': { rich_text: [{ type: 'text', text: { content: taskDescription } }] } // New: Task Description property
                },
                children: notionBlocks // Include progress as children blocks
            };

            const result = await callNotion('/pages', 'POST', payload);
            console.log(`✅ Task created: ${result.url}`);
        } else if (action === 'delete') {
            const pageId = process.argv[3];
            if (!pageId) {
                console.error('Error: pageId is required for delete action.');
                process.exit(1);
            }
            const result = await callNotion(`/pages/${pageId}`, 'PATCH', {
                archived: true
            });
            console.log(`✅ Page archived: ${result.url || pageId}`);
        } else if (action === 'update') {
            const pageId = process.argv[3];
            const status = process.argv[4];
            if (!pageId || !status) {
                console.error('Error: pageId and status are required for update action.');
                process.exit(1);
            }
            const result = await callNotion(`/pages/${pageId}`, 'PATCH', {
                properties: {
                    'Status': { select: { name: status } }
                }
            });
            console.log(`✅ Task status updated to "${status}": ${result.url || pageId}`);
        } else {
            console.log(`Usage:
  node notion-sync.js query [status] [type]     查詢任務
  node notion-sync.js task <title> <agent> [priority] [status] [desc]  建立任務
  node notion-sync.js report <title> <agent>    建立報告
  node notion-sync.js delete <page_id>          刪除（封存）項目
  node notion-sync.js update <page_id> <status> 更新任務狀態

Examples:
  node notion-sync.js query                     列出所有項目
  node notion-sync.js query "進行中"            列出進行中的任務
  node notion-sync.js query "未開始" "Task"     列出未開始的 Task
  node notion-sync.js task "修復 bug" "貳俠" "High" "進行中"
  node notion-sync.js delete "abc-123"          刪除指定 ID 的項目
  node notion-sync.js update "abc-123" "已完成"  將任務狀態設為已完成
`);
        }
    } catch (error) {
        console.error('❌ Notion Sync Failed:', error.message || error);
        process.exit(1);
    }
}

main();
