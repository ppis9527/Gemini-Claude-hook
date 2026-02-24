---
name: custom-model-manager
description: Add custom OpenAI-compatible AI models to OpenClaw configuration. Use this skill when integrating new model providers (e.g., Anthropic, DeepSeek, LocalLLM) or adding models to existing providers.
---

# Custom Model Manager

This skill helps you add new AI models to OpenClaw's configuration. It supports any OpenAI-compatible API provider.

## Usage

When the user wants to add a new model or provider, follow these steps:

1.  **Gather Information**: Ask the user for the following details if not already provided:
    *   **Provider Name**: A short identifier (e.g., `nvidia`, `deepseek`, `openai-custom`).
    *   **Model ID**: The exact model ID string used by the API (e.g., `deepseek-chat`, `claude-3-opus-20240229`).
    *   **Model Name**: A friendly name for display (e.g., "DeepSeek Chat", "Claude 3 Opus").
    *   **API Key**: The API key for the provider (only needed if setting up a new provider).
    *   **Base URL**: The API endpoint URL (only needed if setting up a new provider).
    *   **Context Window**: (Optional) Maximum context size (default: 128000).
    *   **Max Tokens**: (Optional) Maximum output tokens (default: 8192).

2.  **Execute Script**: Run the helper script with the gathered information.

    ```bash
    node /home/jerryyrliu/.openclaw/workspace/skills/custom-model-manager/scripts/add_model.js \
      --provider <PROVIDER_NAME> \
      --modelId <MODEL_ID> \
      --modelName "<MODEL_NAME>" \
      --baseUrl <BASE_URL> \
      --apiKey <API_KEY> \
      --context <CONTEXT_WINDOW> \
      --maxTokens <MAX_TOKENS>
    ```

    *   If adding a model to an *existing* provider, you can omit `--baseUrl` and `--apiKey`.
    *   The script automatically adds the new model to the fallback list (`agents.defaults.model.fallbacks`).

3.  **Restart Gateway**: After the script runs successfully, restart the OpenClaw Gateway to apply changes.

    ```bash
    openclaw gateway restart
    ```

4.  **Verify**: Confirm the model appears in the `/model` menu or by running a test query with the new model.
