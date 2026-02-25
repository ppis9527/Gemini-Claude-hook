/**
 * Shared GDrive upload module using `gog` CLI
 *
 * Usage:
 *   const gdrive = require('./lib/gdrive-upload');
 *   const link = gdrive.upload('/path/to/file.md', 'FOLDER_ID');
 *   const link = gdrive.upsert('/path/to/file.md', 'FOLDER_ID'); // delete existing + upload
 */

const { execSync } = require('child_process');
const path = require('path');

const GOG_ACCOUNT = process.env.GOG_ACCOUNT || 'jerryyrliu@gmail.com';

/**
 * Get the GOG keyring password from gcloud secrets
 */
function getPassword() {
    try {
        return execSync(
            'gcloud secrets versions access latest --secret=GOG_KEYRING_PASSWORD',
            { encoding: 'utf8' }
        ).trim();
    } catch (e) {
        console.error('Failed to get GOG_KEYRING_PASSWORD:', e.message);
        return null;
    }
}

/**
 * Build the gog command with auth
 */
function gogCmd(cmd, password) {
    const pwd = password || getPassword();
    if (!pwd) throw new Error('GOG_KEYRING_PASSWORD not available');
    return `GOG_KEYRING_PASSWORD="${pwd}" gog drive ${cmd} --account "${GOG_ACCOUNT}"`;
}

/**
 * Find files by name in a GDrive folder
 * @param {string} filename - File name to search
 * @param {string} folderId - GDrive folder ID
 * @returns {Array<{id: string, name: string}>} - Matching files
 */
function findByName(filename, folderId) {
    try {
        const password = getPassword();
        if (!password) return [];

        const output = execSync(
            gogCmd(`ls --parent ${folderId} --json`, password),
            { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
        );

        // Parse JSON output - gog drive ls --json returns { "files": [...] }
        const parsed = JSON.parse(output.trim() || '{"files":[]}');
        const files = parsed.files || [];
        return files.filter(f => f.name === filename);
    } catch (e) {
        // Non-JSON output or empty folder
        if (e.message.includes('Unexpected token')) {
            return []; // Empty folder
        }
        console.error('findByName error:', e.message);
        return [];
    }
}

/**
 * Delete a file by ID
 * @param {string} fileId - GDrive file ID
 * @returns {boolean} - Success
 */
function deleteFile(fileId) {
    try {
        const password = getPassword();
        if (!password) return false;

        execSync(gogCmd(`delete ${fileId} --force`, password), { encoding: 'utf8' });
        return true;
    } catch (e) {
        console.error('deleteFile error:', e.message);
        return false;
    }
}

/**
 * Upload a file to GDrive
 * @param {string} filePath - Local file path
 * @param {string} folderId - GDrive folder ID
 * @param {Object} options - Options
 * @param {string} options.name - Override filename
 * @returns {string|null} - GDrive link or null on error
 */
function upload(filePath, folderId, options = {}) {
    const filename = options.name || path.basename(filePath);

    try {
        const password = getPassword();
        if (!password) return null;

        let cmd = `upload "${filePath}" --parent ${folderId}`;
        if (options.name) {
            cmd += ` --name "${options.name}"`;
        }

        const output = execSync(gogCmd(cmd, password), { encoding: 'utf8', timeout: 60000 });

        // Parse output to get link
        // gog drive upload output: "... link https://drive.google.com/..."
        const linkMatch = output.match(/link\s+(https:\/\/[^\s]+)/);
        if (linkMatch) {
            return linkMatch[1];
        }

        // Fallback: return folder link
        console.log(`Uploaded: ${filename}`);
        return `https://drive.google.com/drive/folders/${folderId}`;
    } catch (e) {
        console.error('upload error:', e.message);
        return null;
    }
}

/**
 * Upsert (delete existing + upload) a file to GDrive
 * @param {string} filePath - Local file path
 * @param {string} folderId - GDrive folder ID
 * @param {Object} options - Options
 * @returns {string|null} - GDrive link or null on error
 */
function upsert(filePath, folderId, options = {}) {
    const filename = options.name || path.basename(filePath);

    // Find and delete existing files with same name
    const existing = findByName(filename, folderId);
    for (const file of existing) {
        console.log(`Deleting existing: ${file.name} (${file.id})`);
        deleteFile(file.id);
    }

    // Upload new file
    return upload(filePath, folderId, options);
}

/**
 * Upload with async/Promise API
 */
function uploadAsync(filePath, folderId, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            const link = upload(filePath, folderId, options);
            resolve(link);
        } catch (e) {
            reject(e);
        }
    });
}

function upsertAsync(filePath, folderId, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            const link = upsert(filePath, folderId, options);
            resolve(link);
        } catch (e) {
            reject(e);
        }
    });
}

module.exports = {
    findByName,
    deleteFile,
    upload,
    upsert,
    uploadAsync,
    upsertAsync,
    getPassword,
    GOG_ACCOUNT
};
