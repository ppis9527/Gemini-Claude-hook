---
name: security-expert
description: Advanced AI Security Expert. Combines DevSecOps, 2025 Vulnerability Analysis, and Compliance (GDPR/SOC2). Triggers for security audits, threat modeling, secret scanning, and secure coding reviews.
metadata:
  {
    "openclaw": { "emoji": "🛡️" },
  }
---

# Security Expert Skill

Expert security auditor and analyst specializing in modern DevSecOps, 2025 vulnerability landscape (OWASP), and global compliance frameworks.

## 🔧 Automation Tools

| Tool | Language | Purpose | Usage |
|------|----------|---------|-------|
| `expert-scanner.js` | Node.js | Multi-vector audit: Integrity, Secrets, & Dangerous Code Patterns. | `node scripts/expert-scanner.js <dir>` |
| `security_scan.py` | Python | Logic-based security principle validation. | `python scripts/security_scan.py <dir>` |

## 🧠 Expert Mindset (2025)

1. **Assume Breach**: Operate as if the environment is already compromised.
2. **Zero Trust**: Never trust, always verify every data flow and API call.
3. **Supply Chain Awareness**: 80% of vulnerabilities come from dependencies. Audit lockfiles and registries.
4. **Fail Secure**: Systems must default to "Deny All" upon any exception or error.

## 📋 Core Audit Areas

### 1. OWASP Top 10 (2025 Focus)
- **A01: Broken Access Control**: Check for IDOR, SSRF, and improper CORS.
- **A03: Supply Chain Security**: Validate dependency integrity and provenance.
- **A10: Exceptional Conditions**: Ensure fail-closed error handling.

### 2. Secret Management
- Proactively search for API Keys, Tokens, and Credentials in code and logs.
- Enforce the use of Secret Managers over `.env` files in production.

### 3. Compliance & Governance
- **GDPR/PII**: Data residency, encryption at rest, and right to be forgotten.
- **Threat Modeling**: Use STRIDE/PASTA frameworks to map attack surfaces.

## 🚀 Execution Workflow

1. **Scope**: Identify the target directory or repository.
2. **Scan**: Run `expert-scanner.js` to get an immediate technical baseline.
3. **Analyze**: Apply expert reasoning to prioritize findings by business risk (Likelihood x Impact).
4. **Remediate**: Provide specific code fixes, not just generic advice.
5. **Document**: Generate an actionable Markdown report in `~/.openclaw/workspace/reports/security/`.
