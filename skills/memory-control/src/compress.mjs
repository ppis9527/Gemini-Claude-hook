#!/usr/bin/env node
/**
 * memory-control: Context compression for Gemini CLI
 *
 * 3-step compression process:
 * 1. Generate recap summary
 * 2. Save to session-recap.md
 * 3. Run /compress to truncate context
 */

import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

const GEMINI_DIR = path.join(process.env.HOME ?? "~", ".gemini");

/**
 * Generate a recap summary of the current session.
 */
async function generateRecap(sessionId, workDir) {
  return new Promise((resolve) => {
    const prompt = [
      "Context is getting full. Generate a RECAP SUMMARY of this conversation.",
      "Include:",
      "- Key topics discussed",
      "- Important decisions made",
      "- Current task status (if any)",
      "- Critical context needed to continue",
      "",
      "Format as concise bullet points, max 500 words.",
      "Output ONLY the recap, no preamble or explanation.",
    ].join("\n");

    const proc = spawn(
      "gemini",
      ["-p", prompt, "--resume", sessionId, "-y", "--output-format", "stream-json"],
      { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } }
    );

    let output = "";
    const rl = createInterface({ input: proc.stdout });

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (event.type === "message" && event.role === "assistant") {
          output = event.delta ? output + event.content : event.content;
        }
      } catch { /* skip non-JSON */ }
    });

    proc.stderr?.on("data", (data) => {
      console.error("[generateRecap]", data.toString().trim());
    });

    proc.on("close", (code) => {
      rl.close();
      resolve(code === 0 ? output.trim() : null);
    });

    proc.on("error", (err) => {
      console.error("[generateRecap] error:", err.message);
      resolve(null);
    });

    setTimeout(() => { proc.kill("SIGTERM"); resolve(output.trim() || null); }, 60_000);
  });
}

/**
 * Run /compress to actually truncate the session context.
 */
async function runCompress(sessionId, workDir) {
  return new Promise((resolve) => {
    const proc = spawn(
      "gemini",
      ["-p", "/compress", "--resume", sessionId, "-y"],
      { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } }
    );

    proc.stderr?.on("data", (data) => {
      console.error("[runCompress]", data.toString().trim());
    });

    proc.on("close", (code) => {
      console.log(`[runCompress] exit code: ${code}`);
      resolve(code === 0);
    });

    proc.on("error", (err) => {
      console.error("[runCompress] error:", err.message);
      resolve(false);
    });

    setTimeout(() => { proc.kill("SIGTERM"); resolve(false); }, 30_000);
  });
}

/**
 * Main compression function
 */
export async function compressSession(sessionId, workDir) {
  const recapPath = path.join(workDir, "session-recap.md");

  console.log(`[compress] Step 1: Generating recap for ${sessionId}`);
  const recap = await generateRecap(sessionId, workDir);

  if (!recap) {
    console.error("[compress] Failed to generate recap, aborting");
    return false;
  }

  console.log(`[compress] Step 2: Saving recap (${recap.length} chars)`);
  try {
    writeFileSync(recapPath, recap, "utf-8");
  } catch (err) {
    console.error("[compress] Failed to write recap:", err);
    return false;
  }

  console.log(`[compress] Step 3: Running /compress`);
  const success = await runCompress(sessionId, workDir);

  if (success) {
    console.log(`[compress] Completed successfully`);
  } else {
    console.error(`[compress] /compress command failed`);
  }

  return success;
}

/**
 * Check if compression is needed based on token count
 */
export function shouldCompress(tokenCount, contextWindow, threshold = 0.55) {
  if (!contextWindow || tokenCount <= 0) return false;
  const usage = tokenCount / contextWindow;
  return usage >= threshold;
}

/**
 * Get session recap content (for injection)
 */
export function getSessionRecap(workDir) {
  const recapPath = path.join(workDir, "session-recap.md");
  if (!existsSync(recapPath)) return null;
  try {
    return readFileSync(recapPath, "utf-8").trim();
  } catch {
    return null;
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const [,, sessionId, workDir] = process.argv;

  if (!sessionId || !workDir) {
    console.error("Usage: compress.mjs <sessionId> <workDir>");
    process.exit(1);
  }

  compressSession(sessionId, workDir).then((success) => {
    process.exit(success ? 0 : 1);
  });
}
