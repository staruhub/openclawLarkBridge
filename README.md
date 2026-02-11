# 飞书 ↔ OpenClaw Bridge（openclawLarkBridge）

让 OpenClaw/Clawdbot 智能体直接在飞书里对话，无需公网服务器、无需域名、无需 ngrok。

## 版本记录

- 2026-02：群聊防误触发（仅 @ 或前缀）
- 2026-02：新增链接解析链路（GitHub/公众号/网页/YouTube → Markdown）
- 2026-02：YouTube 兜底（`yt-dlp` 被拦截时可选 `EXA_API_KEY`）
- 2026-02：配置兼容升级（`AI_API_KEY + AI_API_BASE_URL`）

## 亮点

- 纯 WebSocket 直连：飞书云端 ↔ 本地桥接
- 群聊防误触发：仅 @ 机器人或明确前缀才响应
- 多模态：文字、语音、图片、文件
- 链接解析：GitHub / 公众号 / 网页 / YouTube → Markdown

## 架构

```
飞书用户 → 飞书云端 ←WS→ bridge.mjs（你的电脑/服务器） ←WS→ Clawdbot Gateway → AI 智能体
```

## 快速开始

### 1. 创建飞书应用

1. 打开飞书开放平台，创建企业自建应用。
2. 添加机器人能力。
3. 配置权限：`im:message`、`im:message:send_as_bot`、`im:message.p2p_msg`、`im:message.group_at_msg`、`im:resource`。
4. 事件与回调 → 回调配置 → 订阅方式选择“使用长连接接收回调”。
5. 事件配置 → 添加事件 `im.message.receive_v1`。
6. 版本管理与发布 → 创建版本 → 发布。

### 2. 安装

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
nano .env
```

### 4. 启动

```bash
# 确保 Clawdbot Gateway 正在运行
clawdbot gateway --port 18789

# 启动桥接器
npm start
```

### 5. 测试

在飞书里搜索你的机器人并发送消息即可。

## 功能概览

| 功能 | 说明 |
|------|------|
| 文字对话 | Markdown 卡片渲染，代码高亮 |
| 语音输入 | Whisper 语音识别 |
| 语音输出 | TTS 语音合成 |
| 图片生成 | 说“画一只猫”自动生成图片 |
| 图片理解 | 发送图片自动分析内容 |
| 文件处理 | 解析 PDF/Word/TXT |
| 文件发送 | 说“发送文件”发送最近生成的文件 |
| 链接解析 | GitHub/公众号/网页/YouTube → Markdown |

## 链接解析（可选）

链接解析会调用 `link-parser/parse_link.py`，将链接内容解析为 Markdown 并发回飞书。

Ubuntu/Debian 依赖与虚拟环境：

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

YouTube 字幕抓取可能触发登录验证，可选方案：

- Cookies：设置 `YTDLP_COOKIES_FILE=/path/to/cookies.txt`。
- Exa 兜底：设置 `EXA_API_KEY=...`。

## 配置说明

### 关键环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEISHU_APP_ID` | ✅ | 飞书应用 App ID |
| `FEISHU_APP_SECRET_PATH` | ✅ | App Secret 文件路径 |
| `CLAWDBOT_CONFIG_PATH` | ✅ | Clawdbot 配置文件路径 |
| `CLAWDBOT_AGENT_ID` | | Agent ID，默认 `main` |
| `AI_API_KEY` | | AI API Key（语音/图片功能） |
| `AI_API_BASE_URL` | | AI API 地址 |
| `IMAGE_GEN_MODEL` | | 图片生成模型 |
| `FEISHU_GROUP_MENTION_ONLY` | | 1 仅 @ 才响应，0 允许前缀 |
| `FEISHU_BOT_MENTION_NAMES` | | 识别 @ 机器人名称（逗号分隔） |
| `FEISHU_LINK_PREFIXES` | | 链接解析触发前缀（逗号分隔） |
| `FEISHU_LINK_AUTO_P2P` | | 私聊 URL-only 自动解析 |
| `LINKPARSER_SCRIPT` | | 链接解析脚本路径 |
| `LINKPARSER_PY` | | 链接解析 Python 路径 |
| `YTDLP_COOKIES_FILE` | | YouTube cookies |
| `EXA_API_KEY` | | Exa 兜底解析 |

### Clawdbot Gateway 配置示例

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

## 使用示例

| 用户输入 | 机器人响应 |
|----------|------------|
| 你好 | 文字对话 |
| link: https://github.com/.../README.md | 解析链接为 Markdown |
| 画一只猫 | 生成并发送图片 |
| 发送图片 | 分析图片内容 |
| 发送语音 | 识别语音并回复 |
| 发送 PDF | 解析 PDF 并回复 |
| 发送文件 | 发送最近生成的文件 |

## 系统依赖

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

## 安全与敏感信息

- 不要提交 `.env` 或真实密钥到仓库。
- 推荐将密钥写入 `~/.clawdbot/secrets/` 并通过路径读取。
- `.env.example` 仅为示例，占位内容不可用于生产。

## 常见问题

### 消息不响应

```bash
ps aux | grep bridge
pkill -9 -f bridge.mjs
npm start
```

### 语音/图片功能不工作

检查 `AI_API_KEY` 是否配置并且 API 支持对应能力。

### 群聊不响应

确认已添加 `im:message.group_at_msg` 权限。
如只想 @ 触发，设置 `FEISHU_GROUP_MENTION_ONLY=1`。
如机器人昵称不固定，配置 `FEISHU_BOT_MENTION_NAMES`。

### PDF 中文乱码

```bash
apt install fonts-wqy-microhei
```

## 开机自启

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

@reboot sleep 20 && cd /path/to/openclawLarkBridge && nohup node bridge.mjs > /tmp/feishu-bridge.log 2>&1 &
```

## License

MIT

## 致谢

- Clawdbot
- 飞书开放平台
