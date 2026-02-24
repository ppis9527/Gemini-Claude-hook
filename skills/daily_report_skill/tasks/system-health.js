/**
 * Task Module: System Health Check
 * 
 * This module checks the system's disk space usage and reports it.
 * It's a read-only operation that provides diagnostic information.
 * 
 * Returns: {status, logs, diffs, rollback_command}
 * 
 * Author: 叩叩 (KouKou), Code Engineer
 */

const { execSync } = require('child_process');

/**
 * Execute the system health check task
 * @param {object} params - Task parameters (optional)
 * @returns {object} Standardized task result
 */
function execute(params = {}) {
    const logs = [];
    let status = 'success';
    
    try {
        logs.push('Starting system health check...');
        logs.push('');
        
        // Check disk space using df -h
        logs.push('=== Disk Space Report ===');
        try {
            const dfOutput = execSync('df -h', { encoding: 'utf8' });
            logs.push(dfOutput);
            
            // Parse and analyze the output
            const lines = dfOutput.trim().split('\n');
            const headers = lines[0];
            logs.push('');
            logs.push('=== Analysis ===');
            
            // Check each filesystem (skip header)
            let warningFound = false;
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                const parts = line.split(/\s+/);
                
                // Try to extract usage percentage
                if (parts.length >= 5) {
                    const filesystem = parts[0];
                    const usage = parts[4];
                    const mountpoint = parts[5];
                    
                    // Extract percentage value
                    const usageMatch = usage.match(/(\d+)%/);
                    if (usageMatch) {
                        const usagePercent = parseInt(usageMatch[1]);
                        
                        if (usagePercent >= 90) {
                            logs.push(`⚠️  WARNING: ${mountpoint} is at ${usage} capacity (${filesystem})`);
                            warningFound = true;
                        } else if (usagePercent >= 75) {
                            logs.push(`ℹ️  NOTICE: ${mountpoint} is at ${usage} capacity (${filesystem})`);
                        } else {
                            logs.push(`✅ OK: ${mountpoint} is at ${usage} capacity (${filesystem})`);
                        }
                    }
                }
            }
            
            logs.push('');
            if (warningFound) {
                logs.push('⚠️  WARNING: Some filesystems are critically full (>90%)');
                logs.push('Consider cleaning up disk space or archiving old data.');
            } else {
                logs.push('✅ All filesystems have adequate free space.');
            }
            
        } catch (error) {
            logs.push(`ERROR executing df command: ${error.message}`);
            status = 'error';
        }
        
        // Additional system information
        logs.push('');
        logs.push('=== System Information ===');
        
        // Uptime
        try {
            const uptime = execSync('uptime', { encoding: 'utf8' }).trim();
            logs.push(`Uptime: ${uptime}`);
        } catch (error) {
            logs.push(`Could not retrieve uptime: ${error.message}`);
        }
        
        // Memory info (if available)
        try {
            const free = execSync('free -h', { encoding: 'utf8' });
            logs.push('');
            logs.push('Memory Usage:');
            logs.push(free);
        } catch (error) {
            // free command might not be available, skip silently
            logs.push('Memory information not available on this system.');
        }
        
        logs.push('');
        logs.push('System health check completed successfully.');
        
    } catch (error) {
        status = 'error';
        logs.push(`Unexpected error in system-health module: ${error.message}`);
        logs.push(error.stack);
    }
    
    // Return standardized result object
    return {
        status: status,           // 'success', 'error', or 'skipped'
        logs: logs,              // Array of log strings
        diffs: null,             // No file changes for this read-only operation
        rollback_command: null   // No rollback needed for read-only operation
    };
}

// Export the execute function
module.exports = { execute };
