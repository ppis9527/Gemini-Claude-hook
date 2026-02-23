#!/usr/bin/env node
/**
 * Gemini CLI Hook: Auto-compress when context exceeds threshold
 *
 * This hook is called on PostResponse event.
 * Reads token usage from stdin and triggers compression if needed.
 *
 * Hook stdin format (Gemini CLI):
 * {
 *   "session_id": "...",
 *   "hook_event_name": "PostResponse",
 *   "input_tokens": 12345,
 *   "output_tokens": 678,
 *   "model": "gemini-2.5-flash"
 * }
 */

import { compressSession, shouldCompress } from "./compress.mjs";
import path from "node:path";

const COMPRESS_THRESHOLD = 0.55;

const MODEL_CONTEXT_WINDOWS = {
  "gemini-2.5-flash-lite": 1_048_576,
  "gemini-3-flash-preview": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-2.5-pro": 1_048_576,
  "gemini-3-pro-preview": 1_048_576,
};

async function main() {
  // Read hook data from stdin
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  if (!input.trim()) {
    process.exit(0);
  }

  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch (err) {
    console.error("[auto-compress-hook] Invalid JSON input");
    process.exit(0);
  }

  const { session_id, input_tokens, model } = hookData;

  if (!session_id || !input_tokens || !model) {
    // Not enough info, skip
    process.exit(0);
  }

  const contextWindow = MODEL_CONTEXT_WINDOWS[model];
  if (!contextWindow) {
    console.error(`[auto-compress-hook] Unknown model: ${model}`);
    process.exit(0);
  }

  const usage = input_tokens / contextWindow;
  console.error(`[auto-compress-hook] Context: ${input_tokens}/${contextWindow} (${Math.round(usage * 100)}%)`);

  if (shouldCompress(input_tokens, contextWindow, COMPRESS_THRESHOLD)) {
    console.error(`[auto-compress-hook] Threshold exceeded, triggering compression...`);

    // Use current working directory or GEMINI project dir
    const workDir = process.env.GEMINI_PROJECT_DIR || process.cwd();

    const success = await compressSession(session_id, workDir);

    if (success) {
      // Output message to be shown to user
      console.log(JSON.stringify({
        systemMessage: `🗜️ Context compressed (was at ${Math.round(usage * 100)}% capacity)`,
        suppressOutput: false
      }));
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[auto-compress-hook] Error:", err);
  process.exit(1);
});
