/**
 * Tests for tasks/system-health.js module
 * 
 * Verifies the correct output format, status handling, and error conditions.
 */

const { describe, it, expect, vi, beforeEach, afterEach } = require('vitest');
const { execSync } = require('child_process');

// Mock child_process before requiring the module
vi.mock('child_process', () => ({
  execSync: vi.fn()
}));

describe('system-health module', () => {
  let systemHealth;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module cache to get a fresh instance
    vi.resetModules();
    systemHealth = require('../tasks/system-health.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Successful execution path', () => {
    it('should return success status with proper output format', () => {
      // Mock df -h output
      execSync.mockImplementation((cmd) => {
        if (cmd === 'df -h') {
          return 'Filesystem      Size  Used Avail Use% Mounted on\n' +
                 '/dev/sda1       100G   30G   70G  30% /\n' +
                 'tmpfs            16G  1.0G   15G   7% /tmp\n';
        }
        if (cmd === 'uptime') {
          return ' 12:34:56 up 5 days,  3:21,  2 users,  load average: 0.50, 0.40, 0.30';
        }
        if (cmd === 'free -h') {
          return '              total        used        free      shared  buff/cache   available\n' +
                 'Mem:           15Gi       8.0Gi       2.0Gi       100Mi       5.0Gi       7.0Gi\n';
        }
        return '';
      });

      const result = systemHealth.execute({});

      // Verify required fields exist
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('logs');
      expect(result).toHaveProperty('diffs');
      expect(result).toHaveProperty('rollback_command');

      // Verify field types
      expect(result.status).toBe('success');
      expect(Array.isArray(result.logs)).toBe(true);
      expect(result.logs.length).toBeGreaterThan(0);
      expect(result.diffs).toBe(null);
      expect(result.rollback_command).toBe(null);

      // Verify log content
      const logsText = result.logs.join('\n');
      expect(logsText).toContain('Starting system health check');
      expect(logsText).toContain('Disk Space Report');
      expect(logsText).toContain('System health check completed successfully');
    });

    it('should detect and report low disk space warnings', () => {
      execSync.mockImplementation((cmd) => {
        if (cmd === 'df -h') {
          return 'Filesystem      Size  Used Avail Use% Mounted on\n' +
                 '/dev/sda1       100G   92G    8G  92% /\n' +  // High usage
                 'tmpfs            16G  1.0G   15G   7% /tmp\n';
        }
        if (cmd === 'uptime') {
          return ' 12:34:56 up 5 days,  3:21,  2 users,  load average: 0.50, 0.40, 0.30';
        }
        if (cmd === 'free -h') {
          throw new Error('free not available');
        }
        return '';
      });

      const result = systemHealth.execute({});

      expect(result.status).toBe('success');
      
      const logsText = result.logs.join('\n');
      expect(logsText).toContain('WARNING');
      expect(logsText).toContain('92%');
      expect(logsText).toContain('critically full');
    });

    it('should handle filesystems at 75-89% usage with notices', () => {
      execSync.mockImplementation((cmd) => {
        if (cmd === 'df -h') {
          return 'Filesystem      Size  Used Avail Use% Mounted on\n' +
                 '/dev/sda1       100G   80G   20G  80% /\n';
        }
        if (cmd === 'uptime') {
          return ' 12:34:56 up 1 day,  1:00,  1 user,  load average: 0.10, 0.20, 0.30';
        }
        return '';
      });

      const result = systemHealth.execute({});

      expect(result.status).toBe('success');
      
      const logsText = result.logs.join('\n');
      expect(logsText).toContain('NOTICE');
      expect(logsText).toContain('80%');
    });

    it('should handle systems where free command is not available', () => {
      execSync.mockImplementation((cmd) => {
        if (cmd === 'df -h') {
          return 'Filesystem      Size  Used Avail Use% Mounted on\n' +
                 '/dev/sda1       100G   30G   70G  30% /\n';
        }
        if (cmd === 'uptime') {
          return ' 12:34:56 up 1 day';
        }
        if (cmd === 'free -h') {
          throw new Error('free: command not found');
        }
        return '';
      });

      const result = systemHealth.execute({});

      expect(result.status).toBe('success');
      const logsText = result.logs.join('\n');
      expect(logsText).toContain('Memory information not available');
    });
  });

  describe('Error handling', () => {
    it('should handle df command failure gracefully', () => {
      execSync.mockImplementation((cmd) => {
        if (cmd === 'df -h') {
          throw new Error('df: command failed');
        }
        return '';
      });

      const result = systemHealth.execute({});

      expect(result.status).toBe('error');
      expect(result.logs.length).toBeGreaterThan(0);
      
      const logsText = result.logs.join('\n');
      expect(logsText).toContain('ERROR executing df command');
    });

    it('should handle unexpected errors and return error status', () => {
      execSync.mockImplementation(() => {
        throw new Error('Catastrophic failure');
      });

      const result = systemHealth.execute({});

      expect(result.status).toBe('error');
      expect(result.logs.some(log => log.includes('Unexpected error'))).toBe(true);
    });

    it('should still return standardized output structure on error', () => {
      execSync.mockImplementation(() => {
        throw new Error('Test error');
      });

      const result = systemHealth.execute({});

      // Even on error, structure should be consistent
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('logs');
      expect(result).toHaveProperty('diffs');
      expect(result).toHaveProperty('rollback_command');
      
      expect(result.status).toBe('error');
      expect(Array.isArray(result.logs)).toBe(true);
    });
  });

  describe('Output format verification', () => {
    it('should return null for diffs (read-only operation)', () => {
      execSync.mockReturnValue('Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       100G   30G   70G  30% /\n');

      const result = systemHealth.execute({});

      expect(result.diffs).toBe(null);
    });

    it('should return null for rollback_command (read-only operation)', () => {
      execSync.mockReturnValue('Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       100G   30G   70G  30% /\n');

      const result = systemHealth.execute({});

      expect(result.rollback_command).toBe(null);
    });

    it('should include system information section in logs', () => {
      execSync.mockImplementation((cmd) => {
        if (cmd === 'df -h') {
          return 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       100G   30G   70G  30% /\n';
        }
        if (cmd === 'uptime') {
          return ' 12:34:56 up 5 days,  3:21,  2 users,  load average: 0.50, 0.40, 0.30';
        }
        return '';
      });

      const result = systemHealth.execute({});

      const logsText = result.logs.join('\n');
      expect(logsText).toContain('System Information');
      expect(logsText).toContain('Uptime:');
    });

    it('should accept empty params object', () => {
      execSync.mockReturnValue('Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       100G   30G   70G  30% /\n');

      const result = systemHealth.execute({});

      expect(result.status).toBeDefined();
    });

    it('should work when called with no params', () => {
      execSync.mockReturnValue('Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       100G   30G   70G  30% /\n');

      const result = systemHealth.execute();

      expect(result.status).toBeDefined();
      expect(Array.isArray(result.logs)).toBe(true);
    });
  });
});
