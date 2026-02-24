---
name: senior-engineer-workflow
description: The ultimate end-to-end software engineering workflow. Orchestrates Brainstorming, Architecture, Concise Planning, and TDD to ensure high-quality, validated, and tested code output.
metadata:
  {
    "openclaw": { "emoji": "🏗️" },
  }
---

# Senior Engineer Workflow (The Master Cycle)

This workflow orchestrates four specialized skills to transform vague ideas into high-quality production code.

## 🔄 The 4-Stage Cycle

### 1. 🧠 Brainstorming (Design Discovery)
**Goal**: Validate the "Why" and "What".
- Slow down the process. Ask "One Question at a Time".
- Define purpose, target users, and constraints.
- **Hard Gate**: Propose a "Understanding Summary" and wait for user confirmation.
- *Skill Used*: `@brainstorming`

### 2. 🏛️ Architecture (System Design)
**Goal**: Design the "How".
- Define components, data flow, and API contracts.
- Choose technologies (e.g., SQLite, React, MCP).
- Draft the Technical Specification.
- *Skill Used*: `@architecture`

### 3. 📋 Concise Planning (Action Roadmap)
**Goal**: Break into "Atomic Steps".
- Generate a 6-10 item checklist (Verb-first).
- Define "In-scope" and "Out-of-scope".
- Ensure steps are small enough for TDD.
- *Skill Used*: `@concise-planning`

### 4. 🧪 Test-Driven Development (Implementation)
**Goal**: Execute with "Quality Proof".
- **Red**: Write a failing test for the current step.
- **Green**: Write minimal code to pass.
- **Refactor**: Clean up and optimize.
- **NEVER** write implementation before a test.
- *Skill Used*: `@test-driven-development`

### 5. ✅ Validation (Quality Assurance)
**Goal**: Final polish and standards compliance.
- Run static analysis (ESLint, Prettier).
- Check type coverage and documentation.
- Ensure the project remains "Green" overall.
- *Skill Used*: `@lint-and-validate`

### 6. 🛡️ Security Validation (Red Team)
**Goal**: Proactively find vulnerabilities.
- Simulate real-world attacks based on the application's attack surface.
- Use ethical hacking tools (`nmap`, `sqlmap`, etc.) to test defenses.
- Verify that fixes from security scans are effective.
- *Skill Used*: `@ethical-hacking-methodology`

## 🛠️ Error Recovery Path
If any stage (especially TDD) fails repeatedly or encounters non-obvious errors:
1. **STOP** all implementation attempts.
2. **Switch** to the **Systematic Debugging** protocol.
3. Formulate hypotheses, check logs, and isolate the root cause before resuming the workflow.
- *Skill Used*: `@systematic-debugging`

Whenever a user asks for a new feature, a component, or a bug fix:
1. Identify the current stage (usually Stage 1).
2. Explicitly state: "I am initiating the **Senior Engineer Workflow**. We will start with **Brainstorming**."
3. Follow the sequence strictly. Do not skip stages.

---
*Developed by YJ | Master the Art of Engineering.*
