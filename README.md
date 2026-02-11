# 飞书 ↔ OpenClaw Bridge（openclawLarkBridge）

让你的 OpenClaw/Clawdbot 智能体直接在飞书里对话 —— **无需公网服务器、无需域名、无需 ngrok**。

## 🆕 最近更新（2026-02）

- 群聊防误触发：只在 `@机器人` 或明确前缀（`coding:`/`search:`/`link:`）时响应
- 新增链接解析链路：GitHub / 微信公众号 / 通用网页 / YouTube 解析为 Markdown
- YouTube 增强兜底：`yt-dlp` 被拦截时可选使用 `EXA_API_KEY` 做付费解析
- 配置兼容升级：支持 `AI_API_KEY + AI_API_BASE_URL`（兼容 OpenAI 及代理）

## ✨ 功能特性

| 功能 | 描述 |
|------|------|
| 💬 文字对话 | Markdown 卡片渲染，代码高亮 |
| 🎤 语音输入 | Whisper 语音识别 |
| 🔊 语音输出 | TTS 语音合成 |
| 🎨 图片生成 | 说"画一只猫"自动生成图片 |
| 👁️ 图片理解 | 发送图片自动分析内容 |
| 📄 文件处理 | 解析 PDF/Word/TXT |
| 📤 文件发送 | 说"发送文件"发送最近生成的文件 |
| 🔗 链接解析 | 解析 GitHub/微信/网页/YouTube（可选 Exa 兜底）为 Markdown |
| 👥 群聊支持 | 防误触发：只在 @ 到机器人或明确前缀时响应 |

## 🏗️ 架构原理

```
飞书用户 → 飞书云端 ←WS→ bridge.mjs（你的电脑/服务器） ←WS→ Clawdbot Gateway → AI 智能体
```

飞书 SDK 提供 WebSocket 长连接模式，桥接脚本主动连接飞书云端接收消息，再通过本地 WebSocket 转发给 Clawdbot Gateway。**不需要公网 IP、不需要域名、不需要内网穿透**。

## 📋 前置要求

- Node.js >= 18
- 运行中的 Clawdbot Gateway
- 飞书企业自建应用
- （可选）AI API Key（用于语音/图片功能）

## 🚀 快速开始

### 1. 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 点击 **创建企业自建应用**
3. 添加 **机器人** 能力
4. 配置权限：
   - `im:message` - 获取与发送消息
   - `im:message:send_as_bot` - 以机器人身份发送
   - `im:message.p2p_msg` - 接收私聊消息
   - `im:message.group_at_msg` - 接收群聊@消息
   - `im:resource` - 上传/下载文件（文件/语音功能需要）

5. **事件与回调** → **回调配置** → 订阅方式选择 **"使用长连接接收回调"**（关键！）
6. **事件配置** → 添加事件 `im.message.receive_v1`
7. **版本管理与发布** → 创建版本 → 发布

### 2. 安装桥接器

```bash
git clone https://github.com/staruhub/openclawLarkBridge.git
cd openclawLarkBridge
npm install
```

### 3. 配置凭证

```bash
# 创建 secrets 目录
mkdir -p ~/.clawdbot/secrets

# 写入飞书 App Secret
echo "你的AppSecret" > ~/.clawdbot/secrets/feishu_app_secret
chmod 600 ~/.clawdbot/secrets/feishu_app_secret

# （可选）写入 AI API Key（用于语音/图片功能）
echo "sk-xxxx" > ~/.clawdbot/secrets/ai_api_key
chmod 600 ~/.clawdbot/secrets/ai_api_key

# 复制并编辑配置文件
cp .env.example .env
nano .env  # 填入你的 App ID 等配置
```

### 3.1 （可选）启用“链接解析”为 Markdown

链接解析会调用项目内的 `link-parser/parse_link.py`，将 GitHub/微信/网页/YouTube 链接解析为 Markdown 并发回飞书。

Ubuntu/Debian：

```bash
apt-get update
apt-get install -y python3-venv yt-dlp

python3 -m venv ./.venv-linkparser
./.venv-linkparser/bin/pip install --no-cache-dir \
  requests beautifulsoup4 lxml markdownify trafilatura readability-lxml
```

在 `.env` 里配置：

```bash
LINKPARSER_SCRIPT=./link-parser/parse_link.py
LINKPARSER_PY=./.venv-linkparser/bin/python
```

YouTube 字幕抓取在部分环境会触发登录验证。可选解决方案：

- Cookies：设置 `YTDLP_COOKIES_FILE=/path/to/cookies.txt`
- Exa 付费兜底：设置 `EXA_API_KEY=...`（用于抓标题/简介/页面文本并总结）

### 4. 启动

```bash
# 确保 Clawdbot Gateway 正在运行
clawdbot gateway --port 18789

# 启动桥接器
npm start

# 或后台运行
nohup npm start > bridge.log 2>&1 &
```

### 5. 测试

在飞书中搜索你的机器人，发送消息测试！

## ⚙️ 配置说明

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEISHU_APP_ID` | ✅ | 飞书应用 App ID |
| `FEISHU_APP_SECRET_PATH` | ✅ | App Secret 文件路径 |
| `CLAWDBOT_CONFIG_PATH` | ✅ | Clawdbot 配置文件路径 |
| `CLAWDBOT_AGENT_ID` | | Agent ID，默认 `main` |
| `AI_API_KEY` | | AI API Key（语音/图片功能需要） |
| `AI_API_BASE_URL` | | AI API 地址，默认 OpenAI |
| `IMAGE_GEN_MODEL` | | 图片生成模型，默认 `dall-e-3` |
| `FEISHU_THINKING_THRESHOLD_MS` | | "思考中"提示延迟，默认 2500ms |
| `FEISHU_GROUP_MENTION_ONLY` | | 群聊触发：1=仅@机器人，0=允许明确前缀触发 |
| `FEISHU_BOT_MENTION_NAMES` | | 识别@机器人名称（逗号分隔） |
| `FILE_SEARCH_PATHS` | | 文件搜索路径，逗号分隔 |
| `FEISHU_LINK_PREFIXES` | | 链接解析触发前缀（逗号分隔） |
| `FEISHU_LINK_AUTO_P2P` | | 私聊 URL-only 自动解析（1/0） |
| `LINKPARSER_SCRIPT` | | 链接解析脚本路径（默认 `./link-parser/parse_link.py`） |
| `LINKPARSER_PY` | | 链接解析 Python 路径（建议 venv） |
| `YTDLP_COOKIES_FILE` | | YouTube 可选 cookies（解决登录验证） |
| `EXA_API_KEY` | | Exa 付费兜底（YouTube 被拦截时用） |

### Clawdbot 配置

确保 `~/.clawdbot/clawdbot.json` 包含 Gateway 配置：

```json
{
  "gateway": {
    "port": 18789,
    "auth": {
      "token": "your-gateway-token"
    }
  }
}
```

## 📱 使用示例

| 用户输入 | 机器人响应 |
|----------|------------|
| "你好" | 文字对话 |
| "link: https://github.com/.../README.md" | 解析链接为 Markdown |
| "画一只猫" | 生成并发送图片 |
| [发送图片] | 分析图片内容 |
| [发送语音] | 识别语音并回复（可选语音回复） |
| [发送 PDF] | 解析 PDF 并回复 |
| "发送文件" | 发送最近生成的文件 |
| "发送 report.pdf" | 发送指定文件 |

## 🔧 系统依赖

某些功能需要系统工具：

```bash
# 语音处理
apt install ffmpeg

# 链接解析（可选）
apt install python3-venv yt-dlp

# PDF 解析
apt install poppler-utils

# Word 文档解析
apt install pandoc

# 中文字体（PDF 生成）
apt install fonts-wqy-microhei
```

## 🐛 常见问题

### 消息不响应

```bash
# 检查是否有多个 bridge 进程
ps aux | grep bridge
pkill -9 -f bridge.mjs

# 重新启动
npm start
```

### 语音/图片功能不工作

确保配置了 `AI_API_KEY`，并且 API 支持对应的功能。

### 群聊不响应

- 默认：群聊只在“@到机器人”或使用明确前缀时响应（避免 @ 别人机器人也插话）
- 配置：
  - `FEISHU_GROUP_MENTION_ONLY=1`：仅在 @ 到机器人时响应
  - `FEISHU_BOT_MENTION_NAMES=...`：用于识别“@到机器人”
- 确保添加了 `im:message.group_at_msg` 权限

### PDF 中文乱码

```bash
apt install fonts-wqy-microhei
```

## 🔄 开机自启

### systemd（推荐）

```bash
sudo cat > /etc/systemd/system/feishu-bridge.service << EOF
[Unit]
Description=OpenClaw Lark Bridge
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/path/to/openclawLarkBridge
ExecStart=/usr/bin/node bridge.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable feishu-bridge
sudo systemctl start feishu-bridge
```

### crontab

```bash
crontab -e

# 添加：
@reboot sleep 20 && cd /path/to/openclawLarkBridge && nohup node bridge.mjs > /tmp/feishu-bridge.log 2>&1 &
```

## 📄 License

MIT

## 🙏 致谢

- [Clawdbot](https://github.com/anthropics/clawdbot) - AI 智能体框架
- [飞书开放平台](https://open.feishu.cn) - 飞书 SDK
