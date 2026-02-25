/**
 * Noise Filter - Filter low-quality content from memory extraction
 *
 * Removes:
 * - Agent denials ("I don't have data", "I don't recall")
 * - Meta-questions ("Do you remember", "Did I mention")
 * - Session boilerplate ("hi", "hello", "HEARTBEAT")
 * - System messages and tool outputs
 *
 * Usage:
 *   const { isNoise, filterNoise } = require('./noise-filter.js');
 *   if (isNoise(text)) { skip; }
 *   const cleanFacts = filterNoise(facts);
 */

// Agent denial patterns - responses indicating lack of information
const DENIAL_PATTERNS = [
    /i don'?t have (any )?(data|information|record|memory)/i,
    /i don'?t (recall|remember|know)/i,
    /i'?m not (sure|certain|aware)/i,
    /no (data|information|record) (available|found)/i,
    /cannot (find|locate|recall)/i,
    /unable to (find|locate|recall|retrieve)/i,
    /i have no (memory|record|information)/i,
];

// Meta-questions - user asking about memory itself
const META_PATTERNS = [
    /do you (remember|recall|know)/i,
    /did i (mention|tell|say)/i,
    /have i (mentioned|told|said)/i,
    /what did i (say|tell|mention)/i,
    /can you (remember|recall)/i,
    /did we (discuss|talk about)/i,
];

// Session boilerplate - routine session markers
const BOILERPLATE_PATTERNS = [
    /^(hi|hello|hey|yo|嗨|哈囉|你好)\s*[!.,]?\s*$/i,
    /^(bye|goodbye|再見|掰掰)\s*[!.,]?\s*$/i,
    /^(ok|okay|好|好的|了解|收到)\s*[!.,]?\s*$/i,
    /^(thanks?|thank you|謝謝|感謝)\s*[!.,]?\s*$/i,
    /^(yes|no|yep|nope|是|否|對|不對)\s*[!.,]?\s*$/i,
    /heartbeat/i,
    /fresh session/i,
    /session (start|end|begin)/i,
    /\[system\]/i,
    /\[tool\]/i,
];

// System/tool output patterns
const SYSTEM_PATTERNS = [
    /^```[\s\S]*```$/,  // Pure code blocks
    /^\s*\{[\s\S]*\}\s*$/,  // Pure JSON
    /^(error|warning|info):/i,
    /^\[[\w-]+\]/,  // Log prefixes like [INFO], [ERROR]
    /^#+ /,  // Markdown headers only
    /^[-*] /,  // List items only
];

// Very short content (likely not useful)
const MIN_CONTENT_LENGTH = 10;

// Very long content (likely tool output or code dump)
const MAX_CONTENT_LENGTH = 5000;

/**
 * Check if text is noise
 * @param {string} text - Text to check
 * @param {Object} options - Filter options
 * @param {boolean} options.denials - Filter agent denials (default: true)
 * @param {boolean} options.meta - Filter meta-questions (default: true)
 * @param {boolean} options.boilerplate - Filter boilerplate (default: true)
 * @param {boolean} options.system - Filter system output (default: true)
 * @param {boolean} options.length - Filter by length (default: true)
 * @returns {boolean} - True if text is noise
 */
function isNoise(text, options = {}) {
    const opts = {
        denials: true,
        meta: true,
        boilerplate: true,
        system: true,
        length: true,
        ...options
    };

    if (!text || typeof text !== 'string') return true;

    const trimmed = text.trim();

    // Length checks
    if (opts.length) {
        if (trimmed.length < MIN_CONTENT_LENGTH) return true;
        if (trimmed.length > MAX_CONTENT_LENGTH) return true;
    }

    // Pattern checks
    if (opts.denials) {
        for (const pattern of DENIAL_PATTERNS) {
            if (pattern.test(trimmed)) return true;
        }
    }

    if (opts.meta) {
        for (const pattern of META_PATTERNS) {
            if (pattern.test(trimmed)) return true;
        }
    }

    if (opts.boilerplate) {
        for (const pattern of BOILERPLATE_PATTERNS) {
            if (pattern.test(trimmed)) return true;
        }
    }

    if (opts.system) {
        // Only filter if ENTIRE content matches system pattern
        for (const pattern of SYSTEM_PATTERNS) {
            if (pattern.test(trimmed)) return true;
        }
    }

    return false;
}

/**
 * Filter noise from an array of facts/items
 * @param {Array} items - Array of items with 'value' or 'text' property
 * @param {Object} options - Filter options
 * @returns {Array} - Filtered array
 */
function filterNoise(items, options = {}) {
    if (!Array.isArray(items)) return items;

    return items.filter(item => {
        const text = item.value || item.text || item.content || '';
        return !isNoise(text, options);
    });
}

/**
 * Filter noise from conversation text (for extract-facts input)
 * @param {string} conversationText - Full conversation text
 * @param {Object} options - Filter options
 * @returns {string} - Filtered conversation
 */
function filterConversation(conversationText, options = {}) {
    if (!conversationText) return '';

    // Split by message boundaries
    const messages = conversationText.split(/\n\n(?=\[(user|assistant)\])/);

    const filtered = messages.filter(msg => {
        // Extract content after role prefix
        const content = msg.replace(/^\[(user|assistant)\]\s*/i, '');
        return !isNoise(content, options);
    });

    return filtered.join('\n\n');
}

/**
 * Get noise statistics for a set of texts
 * @param {Array<string>} texts - Array of texts to analyze
 * @returns {Object} - Statistics
 */
function getNoiseStats(texts) {
    const stats = {
        total: texts.length,
        noise: 0,
        clean: 0,
        byCategory: {
            denial: 0,
            meta: 0,
            boilerplate: 0,
            system: 0,
            tooShort: 0,
            tooLong: 0,
        }
    };

    for (const text of texts) {
        const trimmed = (text || '').trim();

        if (trimmed.length < MIN_CONTENT_LENGTH) {
            stats.noise++;
            stats.byCategory.tooShort++;
            continue;
        }
        if (trimmed.length > MAX_CONTENT_LENGTH) {
            stats.noise++;
            stats.byCategory.tooLong++;
            continue;
        }

        let isNoisy = false;
        for (const p of DENIAL_PATTERNS) {
            if (p.test(trimmed)) { stats.byCategory.denial++; isNoisy = true; break; }
        }
        if (!isNoisy) {
            for (const p of META_PATTERNS) {
                if (p.test(trimmed)) { stats.byCategory.meta++; isNoisy = true; break; }
            }
        }
        if (!isNoisy) {
            for (const p of BOILERPLATE_PATTERNS) {
                if (p.test(trimmed)) { stats.byCategory.boilerplate++; isNoisy = true; break; }
            }
        }
        if (!isNoisy) {
            for (const p of SYSTEM_PATTERNS) {
                if (p.test(trimmed)) { stats.byCategory.system++; isNoisy = true; break; }
            }
        }

        if (isNoisy) {
            stats.noise++;
        } else {
            stats.clean++;
        }
    }

    return stats;
}

module.exports = {
    isNoise,
    filterNoise,
    filterConversation,
    getNoiseStats,
    // Export patterns for testing/extension
    DENIAL_PATTERNS,
    META_PATTERNS,
    BOILERPLATE_PATTERNS,
    SYSTEM_PATTERNS,
    MIN_CONTENT_LENGTH,
    MAX_CONTENT_LENGTH,
};
