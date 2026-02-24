const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GMAIL_ACCOUNT = "jerryyrliu@gmail.com";
const LABEL_NAME = "OpenClaw-Reports";
const KEYRING_PASS = "openclaw_stable_key";

// 改進的 Markdown 轉 HTML 轉譯器
function markdownToHtml(md) {
    let html = md
        .replace(/^# (.*$)/gm, '<h1 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; margin-bottom: 20px;">$1</h1>')
        .replace(/^## (.*$)/gm, '<h2 style="color: #2980b9; margin-top: 30px; margin-bottom: 15px;">$1</h2>')
        .replace(/^### (.*$)/gm, '<h3 style="color: #16a085; margin-top: 20px;">$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.*?)`/g, '<code style="background: #f4f4f4; padding: 2px 4px; border-radius: 4px; font-family: monospace;">$1</code>')
        .replace(/^\* (.*$)/gm, '<li style="margin-bottom: 8px; list-style-type: disc; margin-left: 20px;">$1</li>')
        .replace(/^- (.*$)/gm, '<li style="margin-bottom: 8px; list-style-type: circle; margin-left: 20px;">$1</li>')
        .replace(/<\/li><br>/g, '</li>')
        .replace(/\n/g, '<br>');

    html = html.replace(/(<br>){3,}/g, '<br><br>');

    return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.7; color: #333; max-width: 700px; margin: auto; padding: 40px; background-color: #ffffff; border: 1px solid #ddd; border-radius: 8px;">
        ${html}
        <div style="margin-top: 50px; padding-top: 20px; border-top: 2px dashed #eee; font-size: 13px; color: #7f8c8d; text-align: center;">
            <p>🚀 <strong>OpenClaw Lobster Protocol</strong> - 系統自動派發</p>
        </div>
    </div>
    `;
}

async function sendDailyReport() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const memoryPath = `/home/jerryyrliu/.openclaw/workspace/memory/${today}.md`;
        
        if (!fs.existsSync(memoryPath)) {
            console.log("No memory file found for today.");
            return;
        }

        const rawContent = fs.readFileSync(memoryPath, 'utf8');
        const htmlContent = markdownToHtml(rawContent);
        const subject = `📊 OpenClaw 執行進度報表 - ${today}`;
        
        // 關鍵修正：將 HTML 內容寫入臨時文件，並使用 --body-html
        // 注意：gogcli 目前的 send 指令 --body-html 接受的是字串
        // 為了處理大型內容並避免 Shell 轉義錯誤，我們使用管道 (Pipeline)
        
        console.log(`Sending professionally formatted HTML report to ${GMAIL_ACCOUNT}...`);
        
        // 將 HTML 內容透過環境變數或臨時文件傳遞，這裡我們改用更穩定的管道方式 (如果 gog 支援)
        // 查閱 help，send 支援 --body-file="-" 代表 stdin
        // 但 --body-html 沒有對應的 file 標誌。
        // 我們測試直接傳遞字串，並對引號進行極致轉義。
        
        const escapedHtml = htmlContent.replace(/'/g, "'\\''");
        const sendCmd = `export GOG_KEYRING_PASSWORD=${KEYRING_PASS} && echo '${escapedHtml}' | gog gmail send --to ${GMAIL_ACCOUNT} --subject "${subject}" --body-html "-" --json`;
        
        const resultRaw = execSync(sendCmd).toString();
        const result = JSON.parse(resultRaw);
        
        if (result && result.threadId) {
            const labelCmd = `export GOG_KEYRING_PASSWORD=${KEYRING_PASS} && gog gmail thread modify ${result.threadId} --add "${LABEL_NAME}" --remove "INBOX"`;
            execSync(labelCmd);
            console.log(`Report successfully delivered.`);
        }
    } catch (error) {
        console.error("Report Delivery Failed:", error.message);
    }
}

sendDailyReport();
