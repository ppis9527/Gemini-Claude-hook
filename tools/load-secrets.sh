#!/bin/bash
# Load all API keys and tokens from GCP Secret Manager into env vars.
# Usage: source ~/.openclaw/workspace/scripts/load-secrets.sh

_fetch() {
  local secret_name="$1"
  local secret_value=$(gcloud secrets versions access latest --secret="$secret_name" 2>/dev/null)
  if [ -z "$secret_value" ]; then
    echo "Warning: Secret '$secret_name' is empty or not found." >&2
  fi
  echo "$secret_value"
}

export GOOGLE_API_KEY="$(_fetch OPENCLAW_API_GOOGLE)"
echo "OPENCLAW_API_GOOGLE loaded: ${#GOOGLE_API_KEY} chars"
export XAI_API_KEY="$(_fetch OPENCLAW_API_XAI)"
echo "OPENCLAW_API_XAI loaded: ${#XAI_API_KEY} chars"
export NVIDIA_API_KEY="$(_fetch NVIDIA_API_KEY)"
echo "NVIDIA_API_KEY loaded: ${#NVIDIA_API_KEY} chars"
export OPENROUTER_API_KEY="$(_fetch OPENROUTER_API_KEY)"
echo "OPENROUTER_API_KEY loaded: ${#OPENROUTER_API_KEY} chars"
export BRAVE_API_KEY="$(_fetch BRAVE_API_KEY)"
echo "BRAVE_API_KEY loaded: ${#BRAVE_API_KEY} chars"
export GOG_KEYRING_PASSWORD="$(_fetch GOG_KEYRING_PASSWORD)"
echo "GOG_KEYRING_PASSWORD loaded: ${#GOG_KEYRING_PASSWORD} chars"
export TELEGRAM_TOKEN_MAIN="$(_fetch TELEGRAM_TOKEN_MAIN)"
echo "TELEGRAM_TOKEN_MAIN loaded: ${#TELEGRAM_TOKEN_MAIN} chars"
export TELEGRAM_TOKEN_BUTLER="$(_fetch TELEGRAM_TOKEN_BUTLER)"
echo "TELEGRAM_TOKEN_BUTLER loaded: ${#TELEGRAM_TOKEN_BUTLER} chars"
export TELEGRAM_TOKEN_ARCH="$(_fetch TELEGRAM_TOKEN_ARCH)"
echo "TELEGRAM_TOKEN_ARCH loaded: ${#TELEGRAM_TOKEN_ARCH} chars"
export TELEGRAM_TOKEN_KOUKOU="$(_fetch TELEGRAM_TOKEN_KOUKOU)"
echo "TELEGRAM_TOKEN_KOUKOU loaded: ${#TELEGRAM_TOKEN_KOUKOU} chars"
export TELEGRAM_TOKEN_QA="$(_fetch TELEGRAM_TOKEN_QA)"
echo "TELEGRAM_TOKEN_QA loaded: ${#TELEGRAM_TOKEN_QA} chars"
export TELEGRAM_TOKEN_MOMO="$(_fetch TELEGRAM_TOKEN_MOMO)"
echo "TELEGRAM_TOKEN_MOMO loaded: ${#TELEGRAM_TOKEN_MOMO} chars"
export NOTION_API_KEY="$(_fetch NOTION_OPENCLAW_KEY)"
echo "NOTION_API_KEY loaded: ${#NOTION_API_KEY} chars"

unset -f _fetch
echo "Loaded 12 secrets from GCP Secret Manager."
