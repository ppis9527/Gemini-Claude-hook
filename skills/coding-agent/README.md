# Coding Agent Skill

Run Codex CLI, Claude Code, OpenCode, or Pi Coding Agent via background process for programmatic control.

## Version

**Current Version:** 1.0.0

## Description

A bash-first skill for programmatic control of coding agents. Supports multiple coding agent backends with PTY support for interactive terminal applications.

## Usage

```bash
# One-shot execution with PTY
bash pty:true command:"codex exec 'Your prompt'"

# Background execution
bash pty:true background:true command:"codex exec 'Your task'"

# With working directory
bash pty:true workdir:~/project command:"claude 'Your task'"
```

## Supported Agents

| Agent | Command | Notes |
|-------|---------|-------|
| Codex | `codex` | Default model: gpt-5.2-codex |
| Claude Code | `claude` | Anthropic's coding agent |
| OpenCode | `opencode` | OpenSource coding agent |
| Pi | `pi` | Node.js based agent |

## Key Features

- **PTY Mode**: Interactive terminal support for coding agents
- **Background Execution**: Run agents in background with session tracking
- **Process Control**: Monitor, send input, and kill sessions
- **Git Worktree Support**: Parallel PR fixing with isolated environments
- **Auto-Notify**: Wake events on completion

## Requirements

- At least one of: claude, codex, opencode, pi
- Git (for Codex and worktree features)

## Changelog

### v1.0.0 (2025-02-19)

- Initial release
- Support for Codex, Claude Code, OpenCode, Pi
- PTY mode for proper terminal support
- Background session management
- Process tool integration (log, write, submit, kill)
- Parallel issue fixing with git worktrees
- Auto-notify on completion
