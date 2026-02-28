#!/usr/bin/env python3
"""
GitHub Trending Daily Report Generator (Robust Scraper Edition)

功能：
1. 直接從 GitHub 官網抓取今日熱門專案 (不依賴第三方 API)。
2. 產出 Markdown 報告（包含日期與 #hashtags）。
3. 透過 gogcli (gog) 上傳至 Google Drive 指定資料夾。
4. 從 GCP Secret Manager 自動獲取 GOG_KEYRING_PASSWORD。
"""

import os
import requests
import datetime
import subprocess
import re
from pathlib import Path

# --- 設定區 ---
FOLDER_ID = "1W6HmBBRL9u7HdBNOHnI_HebVwtatvMu_"
ACCOUNT = "jerryyrliu@gmail.com"
OUTPUT_DIR = Path("/home/jerryyrliu/.openclaw/workspace/reports/github_daily")
DATE_STR = datetime.datetime.now().strftime("%Y-%m-%d")
GOG_BINARY = "/usr/local/bin/gog"

def get_gog_password():
    """從 GCP Secret Manager 獲取 gog keyring 密碼"""
    try:
        cmd = ["gcloud", "secrets", "versions", "access", "latest", "--secret=GOG_KEYRING_PASSWORD"]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except Exception as e:
        print(f"獲取秘密失敗: {e}")
        return None

def fetch_trending():
    """直接從 GitHub 官方抓取趨勢"""
    url = "https://github.com/trending?since=daily"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    try:
        print(f"正在從 GitHub 官方抓取: {url}")
        response = requests.get(url, headers=headers, timeout=15)
        response.raise_for_status()
        html = response.text
        
        # 使用正則表達式簡單提取 (這是一種不依賴 bs4 的備選方案)
        repos = []
        # 匹配文章區塊
        articles = re.findall(r'<article class="Box-row">.*?</article>', html, re.DOTALL)
        
        for article in articles:
            repo = {}
            # 提取作者與名稱
            name_match = re.search(r'href="/([^/]+)/([^/"]+)"', article)
            if name_match:
                repo['author'] = name_match.group(1)
                repo['name'] = name_match.group(2)
                repo['url'] = f"https://github.com/{repo['author']}/{repo['name']}"
            
            # 提取描述
            desc_match = re.search(r'<p class="col-9 color-fg-muted my-1 pr-4">(.*?)</p>', article, re.DOTALL)
            repo['description'] = desc_match.group(1).strip() if desc_match else "無描述"
            
            # 提取語言
            lang_match = re.search(r'itemprop="programmingLanguage">(.*?)</span>', article)
            repo['language'] = lang_match.group(1) if lang_match else "Unknown"
            
            # 提取星數
            stars_match = re.search(r'href="/[^/]+/[^/]+/stargazers">.*?([0-9,]+)', article, re.DOTALL)
            repo['stars'] = stars_match.group(1).replace(',', '') if stars_match else "0"
            
            if 'name' in repo:
                repos.append(repo)
        
        return repos
    except Exception as e:
        print(f"抓取官方網頁失敗：{e}")
        return []

def generate_hashtags(repos):
    """根據內容生成 hashtags"""
    tags = set(["#GitHub", f"#{DATE_STR}", "#DailyReport", "#OpenClaw"])
    languages = [repo.get("language") for repo in repos if repo.get("language") and repo.get("language") != "Unknown"]
    for lang in set(languages[:5]):
        tags.add(f"#{lang.replace(' ', '')}")
    return " ".join(list(tags))

def create_markdown(repos):
    """產出 Markdown 內容"""
    hashtags = generate_hashtags(repos)
    content = f"# GitHub 今日熱門趨勢報告 ({DATE_STR})\n\n"
    content += f"> 自動產出日期: {DATE_STR}\n\n"
    content += f"## 熱門專案摘要 (前 {len(repos[:15])} 名)\n\n"
    
    for repo in repos[:15]:
        name = f"{repo.get('author')}/{repo.get('name')}"
        url = repo.get('url')
        desc = repo.get('description', '無描述')
        stars = repo.get('stars', 0)
        lang = repo.get('language', 'Unknown')
        
        content += f"### [{name}]({url})\n"
        content += f"- **描述**: {desc}\n"
        content += f"- **語言**: {lang} | **星星數**: {stars}\n\n"
        
    content += f"\n---\n{hashtags}\n"
    return content

def upload_with_gog(file_path):
    """使用 gog 工具上傳檔案"""
    password = get_gog_password()
    if not password:
        print("缺少密碼，無法上傳。")
        return

    print(f"正在透過 gog 上傳 {file_path.name}...")
    
    # 設置環境變數
    env = os.environ.copy()
    env["GOG_KEYRING_PASSWORD"] = password
    
    cmd = [
        GOG_BINARY, "drive", "upload", str(file_path),
        "--parent", FOLDER_ID,
        "--account", ACCOUNT,
        "--no-input"
    ]
    
    try:
        # 直接執行，不再使用 stdin
        result = subprocess.run(
            cmd, 
            env=env,
            capture_output=True, 
            text=True
        )
        
        if result.returncode == 0:
            print("上傳成功！")
            if result.stdout: print(result.stdout.strip())
        else:
            print(f"上傳失敗 (Exit {result.returncode})")
            print(result.stderr.strip())
    except Exception as e:
        print(f"執行 gog 發生錯誤: {e}")

def main():
    print(f"=== GitHub 每日趨勢報表生成器 ({DATE_STR}) ===")
    repos = fetch_trending()
    if not repos:
        print("未抓取到任何資料，請檢查網頁格式或網路連結。")
        return

    print(f"成功抓取到 {len(repos)} 個專案。")
    md_content = create_markdown(repos)
    file_name = f"github_daily_report_{DATE_STR}.md"
    file_path = OUTPUT_DIR / file_name
    
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    
    print(f"1. 報告已儲存至: {file_path}")
    
    upload_with_gog(file_path)

if __name__ == "__main__":
    main()
