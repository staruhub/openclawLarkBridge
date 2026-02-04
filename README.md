# 飞书 ↔ Clawdbot Bridge

让你的 Clawdbot 智能体直接在飞书里对话 —— **无需公网服务器、无需域名、无需 ngrok**。

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
| 👥 群聊支持 | 智能过滤，只响应 @、提问、请求 |

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
git clone https://github.com/pongpong/feishu-clawdbot-bridge.git
cd feishu-clawdbot-bridge
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
| `FILE_SEARCH_PATHS` | | 文件搜索路径，逗号分隔 |

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

- 群聊只响应 @、提问、请求类消息
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
Description=Feishu Clawdbot Bridge
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/clawd/feishu-clawdbot-bridge
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
@reboot sleep 20 && cd /root/clawd/feishu-clawdbot-bridge && nohup node bridge.mjs > /tmp/feishu-bridge.log 2>&1 &
```

## 📄 License

MIT

## 🙏 致谢

- [Clawdbot](https://github.com/anthropics/clawdbot) - AI 智能体框架
- [飞书开放平台](https://open.feishu.cn) - 飞书 SDK
