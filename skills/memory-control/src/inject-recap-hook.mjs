#!/usr/bin/env node
/**
 * Gemini CLI Hook: Inject session recap on SessionStart
 *
 * This hook is called on SessionStart event.
 * If session-recap.md exists, injects it as additional context.
 */

import { getSessionRecap } from "./compress.mjs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

async function main() {
  // Read hook data from stdin
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  const workDir = process.env.GEMINI_PROJECT_DIR || process.cwd();

  // Check for session recap
  const recap = getSessionRecap(workDir);

  if (recap) {
    // Output hook response with additional context
    console.log(JSON.stringify({
      hookSpecificOutput: {
        additionalContext: `[Session Recap - Previous Context]\n${recap}`
      },
      systemMessage: "📋 Session recap loaded.",
      suppressOutput: true
    }));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[inject-recap-hook] Error:", err);
  process.exit(1);
});
