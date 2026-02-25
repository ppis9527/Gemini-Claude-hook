// Four-Step Verdict: Filter low-quality/expired facts during memory retrieval
// Implements MemOS-style memory quality control

/**
 * Apply verdict filters to memory rows
 * @param {Array} rows - Array of memory objects with key, value, start_time
 * @param {Object} options - Filter options
 * @param {boolean} options.sourceVerified - Exclude inferred.* keys
 * @param {string} options.subject - Filter by subject (key must include this string)
 * @param {number} options.maxAgeDays - Filter by age (days since start_time)
 * @returns {Array} Filtered rows
 */
function applyVerdict(rows, options = {}) {
    return rows.filter(r => {
        // 1. sourceVerified: exclude inferred facts (AI-generated, not user-stated)
        if (options.sourceVerified && r.key && r.key.startsWith('inferred.')) {
            return false;
        }

        // 2. subject: filter by subject/topic
        if (options.subject && r.key && !r.key.includes(options.subject)) {
            return false;
        }

        // 3. maxAgeDays: time-based filtering
        if (options.maxAgeDays && r.start_time) {
            const ageMs = Date.now() - new Date(r.start_time).getTime();
            const ageDays = ageMs / (24 * 60 * 60 * 1000);
            if (ageDays > options.maxAgeDays) {
                return false;
            }
        }

        return true;
    });
}

module.exports = { applyVerdict };
