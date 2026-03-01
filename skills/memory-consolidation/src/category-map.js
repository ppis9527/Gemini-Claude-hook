/**
 * Shared category mapping — consolidates ~39 raw key prefixes into 12 topics.
 * Used by step 7 (weekly) and step 8 (rolling topics).
 */

const CATEGORY_MAP = {
    // agent — agent configs, cases, patterns, workflows
    agent: 'agent',
    workflow: 'agent',
    // claude — Claude Code specific
    claude: 'claude',
    // project — projects, builds, scripts, deployments
    project: 'project',
    build: 'project',
    script: 'project',
    // config — all configuration, env, prefs
    config: 'config',
    environment: 'config',
    system: 'config',
    pref: 'config',
    preference: 'config',
    // infra — gateway, networking, auth, paths
    infra: 'infra',
    gateway: 'infra',
    location: 'infra',
    auth: 'infra',
    // memory — memory system, context
    memory: 'memory',
    context: 'memory',
    // comms — telegram, channels, messages, bindings
    comms: 'comms',
    channel: 'comms',
    telegram: 'comms',
    message: 'comms',
    conversation: 'comms',
    binding: 'comms',
    // user — user info, team
    user: 'user',
    team: 'user',
    // task — tasks, events, decisions
    task: 'task',
    event: 'task',
    decision: 'task',
    // tool — tools, skills, plugins
    tool: 'tool',
    skill: 'tool',
    plugin: 'tool',
    // error — errors, corrections, debugging
    error: 'error',
    correction: 'error',
    debug: 'error',
    // meta — models, analysis, tests, misc
    meta: 'meta',
    model: 'meta',
    analysis: 'meta',
    test: 'meta',
    openclaw: 'meta',
    gemini_cli: 'meta',
    entity: 'meta',
};

function mapCategory(rawCategory) {
    return CATEGORY_MAP[rawCategory] || rawCategory;
}

module.exports = { CATEGORY_MAP, mapCategory };
