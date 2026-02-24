#!/usr/bin/env node

/**
 * Nightly Build Daily Report System - Orchestrator
 * 
 * This is the core script that manages the lifecycle of the nightly build process.
 * It loads configuration, executes task modules, handles errors, and generates
 * a comprehensive Markdown report with audit trails and rollback commands.
 * 
 * Author: 叩叩 (KouKou), Code Engineer
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const CONFIG_FILE = path.join(__dirname, 'nightly_config.json');
// Changed to central reports directory
const BRIEFINGS_DIR = path.join(process.env.HOME, '.openclaw/workspace/reports/daily');
const ARCHIVE_DIR = path.join(BRIEFINGS_DIR, 'archive');
const SNAPSHOTS_DIR = path.join(__dirname, 'workspace', 'snapshots');
const SNAPSHOT_RETENTION_DAYS = 7;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function getTimestamp() {
    return new Date().toISOString();
}

function getDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function loadConfig(configPath) {
    try {
        const configData = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(configData);
    } catch (error) {
        console.error(`[ERROR] Failed to load config from ${configPath}:`, error.message);
        process.exit(1);
    }
}

function createSnapshot(taskName, resources) {
    const timestamp = Date.now();
    const snapshotDir = path.join(SNAPSHOTS_DIR, `${taskName}_${timestamp}`);
    
    ensureDirectory(snapshotDir);
    
    console.log(`[SNAPSHOT] Creating snapshot for task: ${taskName}`);
    
    resources.forEach(resource => {
        if (fs.existsSync(resource)) {
            const basename = path.basename(resource);
            const destPath = path.join(snapshotDir, basename);
            
            try {
                execSync(`cp -r "${resource}" "${destPath}"`, { stdio: 'pipe' });
                console.log(`[SNAPSHOT]   ✓ Backed up: ${resource}`);
            } catch (error) {
                console.warn(`[SNAPSHOT]   ⚠ Failed to backup ${resource}:`, error.message);
            }
        }
    });
    
    return snapshotDir;
}

function executeModule(taskName, params) {
    const modulePath = path.join(__dirname, 'tasks', `${taskName}.js`);
    
    if (!fs.existsSync(modulePath)) {
        return {
            status: 'error',
            logs: [`Module not found: ${modulePath}`],
            diffs: null,
            rollback_command: null
        };
    }
    
    try {
        console.log(`[EXEC] Running module: ${taskName}`);
        const taskModule = require(modulePath);
        const result = taskModule.execute(params);
        
        if (!result.status || !result.logs) {
            throw new Error('Invalid module response: missing required fields');
        }
        
        return result;
    } catch (error) {
        return {
            status: 'error',
            logs: [`Exception in module ${taskName}: ${error.message}`, error.stack],
            diffs: null,
            rollback_command: null
        };
    }
}

function preFlightChecks() {
    const results = {
        passed: true,
        checks: []
    };
    
    try {
        const dfOutput = execSync('df -h .', { encoding: 'utf8' });
        const lines = dfOutput.trim().split('\n');
        const dataLine = lines[1];
        const parts = dataLine.split(/\s+/);
        const usagePercent = parseInt(parts[4]);
        
        results.checks.push({
            name: 'Disk Space',
            status: usagePercent < 90 ? 'pass' : 'warn',
            message: `Disk usage: ${parts[4]} (${parts[2]} used of ${parts[1]})`
        });
        
        if (usagePercent >= 95) {
            results.passed = false;
        }
    } catch (error) {
        results.checks.push({
            name: 'Disk Space',
            status: 'error',
            message: `Failed to check disk space: ${error.message}`
        });
    }
    
    if (fs.existsSync('/proc/meminfo')) {
        try {
            const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
            const totalMatch = meminfo.match(/MemTotal:\s+(\d+)/);
            const availMatch = meminfo.match(/MemAvailable:\s+(\d+)/);
            
            if (totalMatch && availMatch) {
                const total = parseInt(totalMatch[1]);
                const avail = parseInt(availMatch[1]);
                const usedPercent = Math.round((total - avail) / total * 100);
                
                results.checks.push({
                    name: 'Memory',
                    status: usedPercent < 90 ? 'pass' : 'warn',
                    message: `Memory usage: ${usedPercent}%`
                });
            }
        } catch (error) {}
    }
    
    return results;
}

function generateMarkdown(results, preFlightResults) {
    const dateStr = getDateString();
    const timestamp = new Date().toLocaleString();
    
    let markdown = `# Nightly Build Report - ${dateStr}\n\n`;
    markdown += `**Generated:** ${timestamp}\n\n`;
    markdown += `---\n\n`;
    
    markdown += `## 🔍 Pre-Flight Checks\n\n`;
    if (preFlightResults.passed) {
        markdown += `✅ **Status:** All checks passed\n\n`;
    } else {
        markdown += `⚠️ **Status:** Some checks failed or raised warnings\n\n`;
    }
    
    markdown += `| Check | Status | Details |\n`;
    markdown += `|-------|--------|----------|\n`;
    preFlightResults.checks.forEach(check => {
        const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
        markdown += `| ${check.name} | ${icon} ${check.status.toUpperCase()} | ${check.message} |\n`;
    });
    markdown += `\n---\n\n`;
    
    markdown += `## 📊 Execution Summary\n\n`;
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const skipCount = results.filter(r => r.status === 'skipped').length;
    
    markdown += `- **Total Tasks:** ${results.length}\n`;
    markdown += `- **✅ Successful:** ${successCount}\n`;
    markdown += `- **❌ Failed:** ${errorCount}\n`;
    markdown += `- **⏭️ Skipped:** ${skipCount}\n\n`;
    
    markdown += `## 📋 Audit Trail\n\n`;
    markdown += `| Module | Action | Outcome | Impact |\n`;
    markdown += `|--------|--------|---------|--------|\n`;
    
    results.forEach(result => {
        const statusIcon = result.status === 'success' ? '✅' : 
                          result.status === 'error' ? '❌' : '⏭️';
        const impact = result.is_write_operation ? '⚠️ Write' : '👁️ Read';
        markdown += `| ${result.task_name} | ${result.action || 'N/A'} | ${statusIcon} ${result.status} | ${impact} |\n`;
    });
    markdown += `\n---\n\n`;
    
    markdown += `## 📝 Detailed Results\n\n`;
    
    results.forEach((result, index) => {
        const statusIcon = result.status === 'success' ? '✅' : 
                          result.status === 'error' ? '❌' : '⏭️';
        
        markdown += `### ${index + 1}. ${statusIcon} ${result.task_name}\n\n`;
        markdown += `- **Status:** ${result.status.toUpperCase()}\n`;
        markdown += `- **Execution Time:** ${result.execution_time}ms\n`;
        
        if (result.action) {
            markdown += `- **Action:** ${result.action}\n`;
        }
        
        markdown += `\n**Logs:**\n\n`;
        markdown += '```\n';
        result.logs.forEach(log => {
            markdown += `${log}\n`;
        });
        markdown += '```\n\n';
        
        if (result.diffs && result.diffs.length > 0) {
            markdown += `<details>\n`;
            markdown += `<summary>📄 View Changes (${result.diffs.length} file(s))</summary>\n\n`;
            result.diffs.forEach(diff => {
                markdown += `\`\`\`diff\n${diff}\n\`\`\`\n\n`;
            });
            markdown += `</details>\n\n`;
        }
        
        if (result.rollback_command) {
            markdown += `**🔄 Rollback Command:**\n\n`;
            markdown += '```bash\n';
            markdown += `${result.rollback_command}\n`;
            markdown += '```\n\n';
        }
        
        markdown += `---\n\n`;
    });
    
    markdown += `## 🏁 Report Complete\n\n`;
    markdown += `This report was automatically generated by the Nightly Build System.\n`;
    markdown += `All operations have been logged and can be reversed using the provided rollback commands.\n`;
    
    return markdown;
}

function pruneOldSnapshots() {
    if (!fs.existsSync(SNAPSHOTS_DIR)) {
        return;
    }
    
    const now = Date.now();
    const cutoffTime = now - (SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    console.log(`[CLEANUP] Pruning snapshots older than ${SNAPSHOT_RETENTION_DAYS} days...`);
    
    const snapshots = fs.readdirSync(SNAPSHOTS_DIR);
    let prunedCount = 0;
    
    snapshots.forEach(snapshot => {
        const snapshotPath = path.join(SNAPSHOTS_DIR, snapshot);
        const stats = fs.statSync(snapshotPath);
        
        if (stats.mtimeMs < cutoffTime) {
            try {
                fs.rmSync(snapshotPath, { recursive: true, force: true });
                console.log(`[CLEANUP]   ✓ Removed: ${snapshot}`);
                prunedCount++;
            } catch (error) {
                console.warn(`[CLEANUP]   ⚠ Failed to remove ${snapshot}:`, error.message);
            }
        }
    });
    
    console.log(`[CLEANUP] Pruned ${prunedCount} old snapshot(s)`);
}

/**
 * Archives old briefing files
 */
function archiveOldBriefings() {
    ensureDirectory(ARCHIVE_DIR);
    console.log('[ARCHIVE] Checking for old briefings...');
    
    if (fs.existsSync(BRIEFINGS_DIR)) {
        const files = fs.readdirSync(BRIEFINGS_DIR);
        files.filter(f => f.endsWith('.md')).forEach(f => {
            const oldPath = path.join(BRIEFINGS_DIR, f);
            const newPath = path.join(ARCHIVE_DIR, f);
            try {
                fs.renameSync(oldPath, newPath);
                console.log(`[ARCHIVE]   ✓ Moved ${f} to archive`);
            } catch (e) {
                console.error(`[ARCHIVE]   ⚠ Failed to move ${f}:`, e.message);
            }
        });
    }
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

async function main() {
    console.log('='.repeat(70));
    console.log('  NIGHTLY BUILD ORCHESTRATOR - Starting');
    console.log('='.repeat(70));
    console.log(`Started at: ${new Date().toLocaleString()}\n`);
    
    // 1. Initialize
    // Archive first!
    archiveOldBriefings();

    const dateStr = getDateString();
    const reportPath = path.join(BRIEFINGS_DIR, `${dateStr}.md`);
    
    ensureDirectory(BRIEFINGS_DIR);
    ensureDirectory(SNAPSHOTS_DIR);
    
    console.log(`[INIT] Report will be saved to: ${reportPath}\n`);
    
    const config = loadConfig(CONFIG_FILE);
    console.log(`[CONFIG] Loaded configuration with ${config.enabled_tasks.length} task(s)\n`);
    
    // 2. Pre-Flight Checks
    console.log('[PRE-FLIGHT] Running system health checks...');
    const preFlightResults = preFlightChecks();
    console.log(`[PRE-FLIGHT] Result: ${preFlightResults.passed ? 'PASSED' : 'WARNINGS DETECTED'}\n`);
    
    if (!preFlightResults.passed && config.abort_on_preflight_failure) {
        console.error('[ERROR] Pre-flight checks failed and abort_on_preflight_failure is enabled');
        console.error('Aborting execution.');
        process.exit(1);
    }
    
    // 3. Execution Loop
    const results = [];
    
    for (const task of config.enabled_tasks) {
        console.log('-'.repeat(70));
        const startTime = Date.now();
        
        let result = {
            task_name: task.name,
            action: task.description || 'No description',
            is_write_operation: task.is_write_operation || false,
            execution_time: 0,
            status: 'unknown',
            logs: [],
            diffs: null,
            rollback_command: null
        };
        
        try {
            if (task.is_write_operation && task.target_resources) {
                const snapshotDir = createSnapshot(task.name, task.target_resources);
                result.logs.push(`Snapshot created: ${snapshotDir}`);
            }
            
            const moduleResult = executeModule(task.name, task.params || {});
            
            result.status = moduleResult.status;
            result.logs = result.logs.concat(moduleResult.logs);
            result.diffs = moduleResult.diffs;
            result.rollback_command = moduleResult.rollback_command;
            
        } catch (error) {
            result.status = 'error';
            result.logs.push(`Unexpected error: ${error.message}`);
            result.logs.push(error.stack);
        }
        
        result.execution_time = Date.now() - startTime;
        results.push(result);
        
        console.log(`[RESULT] ${task.name}: ${result.status.toUpperCase()} (${result.execution_time}ms)\n`);
    }
    
    // 4. Generate Report
    console.log('-'.repeat(70));
    console.log('[REPORT] Generating Markdown report...');
    const markdownContent = generateMarkdown(results, preFlightResults);
    fs.writeFileSync(reportPath, markdownContent, 'utf8');
    console.log(`[REPORT] ✓ Report saved to: ${reportPath}\n`);
    
    // 5. Cleanup
    console.log('[CLEANUP] Running cleanup tasks...');
    pruneOldSnapshots();
    console.log('[CLEANUP] ✓ Cleanup complete\n');
    
    console.log('='.repeat(70));
    console.log('  NIGHTLY BUILD ORCHESTRATOR - Complete');
    console.log('='.repeat(70));
    console.log(`Finished at: ${new Date().toLocaleString()}`);
    console.log(`Total tasks executed: ${results.length}`);
    console.log(`Report available at: ${reportPath}`);
    console.log('='.repeat(70));
}

if (require.main === module) {
    main().catch(error => {
        console.error('[FATAL ERROR]', error);
        process.exit(1);
    });
}

module.exports = { main };
