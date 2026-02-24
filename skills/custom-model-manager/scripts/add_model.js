const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.openclaw/openclaw.json');

function parseArgs() {
    const args = process.argv.slice(2);
    const result = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const value = args[i + 1];
            if (value && !value.startsWith('--')) {
                result[key] = value;
                i++;
            } else {
                result[key] = true;
            }
        }
    }
    return result;
}

function updateConfig(options) {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error(`Config file not found: ${CONFIG_PATH}`);
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

    // Validate inputs
    if (!options.provider || !options.modelId || !options.modelName) {
        console.error('Missing required arguments: --provider, --modelId, --modelName are mandatory.');
        process.exit(1);
    }

    // Initialize provider structure if needed
    if (!config.models) config.models = {};
    if (!config.models.providers) config.models.providers = {};
    
    // Check/Create provider
    let provider = config.models.providers[options.provider];
    if (!provider) {
        if (!options.baseUrl || !options.apiKey) {
            console.error(`New provider '${options.provider}' requires --baseUrl and --apiKey.`);
            process.exit(1);
        }
        provider = {
            baseUrl: options.baseUrl,
            apiKey: options.apiKey,
            api: 'openai-completions', // Default to OpenAI compatible
            models: []
        };
        config.models.providers[options.provider] = provider;
        console.log(`Created new provider: ${options.provider}`);
    } else {
        // Update existing provider if args provided
        if (options.baseUrl) provider.baseUrl = options.baseUrl;
        if (options.apiKey) provider.apiKey = options.apiKey;
        console.log(`Updated existing provider: ${options.provider}`);
    }

    // Add/Update Model
    const model = {
        id: options.modelId,
        name: options.modelName,
        contextWindow: parseInt(options.context) || 128000,
        maxTokens: parseInt(options.maxTokens) || 8192
    };

    // Find if model exists
    const existingModelIndex = provider.models.findIndex(m => m.id === options.modelId);
    if (existingModelIndex !== -1) {
        provider.models[existingModelIndex] = model;
        console.log(`Updated model: ${options.modelId}`);
    } else {
        provider.models.push(model);
        console.log(`Added model: ${options.modelId}`);
    }

    // Add to fallbacks
    if (options.fallback !== 'false') {
        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};
        if (!config.agents.defaults.model) config.agents.defaults.model = {};
        if (!config.agents.defaults.model.fallbacks) config.agents.defaults.model.fallbacks = [];

        const fallbackId = `${options.provider}/${options.modelId}`;
        if (!config.agents.defaults.model.fallbacks.includes(fallbackId)) {
            // Add to the beginning of fallbacks for higher priority
            config.agents.defaults.model.fallbacks.unshift(fallbackId);
            console.log(`Added to fallbacks: ${fallbackId}`);
        }
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log('Configuration updated successfully.');
}

const options = parseArgs();
updateConfig(options);
