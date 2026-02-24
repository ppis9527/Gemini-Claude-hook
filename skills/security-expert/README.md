# Security Expert Skill

Advanced security auditing, vulnerability analysis, and secure API design patterns. This skill integrates the best of `security-auditor`, `vulnerability-scanner`, `security_audit_skill`, and `api-security-best-practices` into a single, cohesive engine.

## Features

### 🛡️ Multi-Vector Scanning (`expert-scanner.js`)
Detects API Secrets (OpenAI, AWS, etc.), Dangerous Code Patterns (`eval`, `exec`), and insecure configurations.

### 🧠 Secure API Design (See `API_SECURITY.md`)
Implementation guides for:
- JWT & OAuth 2.0 Auth flows.
- Input validation & SQL injection prevention.
- Rate limiting & DDoS protection.

### 🌐 Expert Reasoning (OWASP 2025)
Threat modeling and compliance mapping (GDPR, SOC2) for modern DevSecOps environments.

## Usage

### Baseline Scan
```bash
node scripts/expert-scanner.js <target_directory>
```

### API Implementation Review
> "Help me implement a secure login flow using the patterns in security-expert."

---
Created by YJ | 2026-02-21
