---
name: smart-fetch
description: Token-efficient web scraping with Playwright
version: 1.0.0
tools:
  - fetch.js
---

# smart-fetch

Token-efficient web scraping with Playwright.

## Usage

```bash
# Basic fetch
smart-fetch https://example.com

# With CSS selector (extract specific content)
smart-fetch https://example.com --selector "article.main"

# Readability mode (auto-clean content)
smart-fetch https://example.com --readability

# With US proxy (bypass geo-restrictions)
smart-fetch https://example.com --proxy

# Wait for dynamic content
smart-fetch https://example.com --wait 3000

# Output formats
smart-fetch https://example.com --format json
smart-fetch https://example.com --format markdown
smart-fetch https://example.com --format text

# Screenshot
smart-fetch https://example.com --screenshot output.png

# Headed mode (visible browser)
smart-fetch https://example.com --headed

# Batch URLs
smart-fetch urls.txt --batch
```

## Options

| Option | Description |
|--------|-------------|
| `--selector <css>` | CSS selector to extract specific elements |
| `--readability` | Use Readability.js to extract main content |
| `--proxy` | Use US proxy (socks5://136.109.240.186:1080) |
| `--wait <ms>` | Wait for dynamic content (default: 1000) |
| `--format <fmt>` | Output format: text, markdown, json (default: text) |
| `--screenshot <file>` | Save screenshot to file |
| `--headed` | Run browser in headed mode |
| `--batch` | Process multiple URLs from file |
| `--timeout <ms>` | Page load timeout (default: 30000) |

## Proxy Info

- **VM**: proxy-us @ us-west1-b
- **IP**: 136.109.240.186:1080
- **Secret**: SOCKS5_PROXY_US

### When to use proxy

| Scenario | Use Proxy |
|----------|-----------|
| US-only services | Yes |
| Reddit | No (blocks all cloud IPs) |
| Web3/DeFi | No (blocks US IPs) |
| Asian services | No |

## Examples

```bash
# Fetch GitHub trending
smart-fetch https://github.com/trending --selector "article.Box-row" --format json

# Fetch news article (clean)
smart-fetch https://example.com/article --readability --format markdown

# Batch fetch with proxy
echo -e "https://site1.com\nhttps://site2.com" > urls.txt
smart-fetch urls.txt --batch --proxy --format json
```
