/**
 * Feishu ↔ Clawdbot Bridge (v3.3 - Voice + Image + File)
 */
import * as Lark from '@larksuiteoapi/node-sdk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import WebSocket from 'ws';
import 'dotenv/config';

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET_PATH = resolve(process.env.FEISHU_APP_SECRET_PATH || '~/.clawdbot/secrets/feishu_app_secret');
const DEFAULT_CONFIG_PATH = fs.existsSync(path.join(os.homedir(), '.openclaw', 'openclaw.json'))
  ? '~/.openclaw/openclaw.json'
  : '~/.clawdbot/clawdbot.json';
const CLAWDBOT_CONFIG_PATH = resolve(process.env.CLAWDBOT_CONFIG_PATH || process.env.OPENCLAW_CONFIG_PATH || DEFAULT_CONFIG_PATH);
const CLAWDBOT_AGENT_ID = process.env.CLAWDBOT_AGENT_ID || 'main';
const CLAWDBOT_CODE_AGENT_ID = process.env.CLAWDBOT_CODE_AGENT_ID || 'coding';
const FEISHU_CODE_PREFIXES = (process.env.FEISHU_CODE_PREFIXES || 'coding:,@code,@coding,/code')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const FEISHU_SEARCH_PREFIXES = (process.env.FEISHU_SEARCH_PREFIXES || 'search:,@search,研究:,@research')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const FEISHU_LINK_PREFIXES = (process.env.FEISHU_LINK_PREFIXES || 'link:,链接:,解析:,url:')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const FEISHU_LINK_AUTO_P2P = String(process.env.FEISHU_LINK_AUTO_P2P || '1') === '1';
const FEISHU_LINK_MAX_URLS = Number(process.env.FEISHU_LINK_MAX_URLS || 3);
const FEISHU_LINK_MAX_CHARS = Number(process.env.FEISHU_LINK_MAX_CHARS || 16000);
const FEISHU_LINK_TIMEOUT_MS = Number(process.env.FEISHU_LINK_TIMEOUT_MS || 90000);
// Link parser defaults:
// - Python: use system python3 by default; recommend venv and override via LINKPARSER_PY
// - Script: default to repo-local ./link-parser/parse_link.py
const LINKPARSER_PY = String(process.env.LINKPARSER_PY || 'python3');
const LINKPARSER_SCRIPT = String(process.env.LINKPARSER_SCRIPT || path.join(process.cwd(), 'link-parser', 'parse_link.py'));
const FEISHU_FORCE_EXA_ON_SEARCH = String(process.env.FEISHU_FORCE_EXA_ON_SEARCH || '1') === '1';
const FEISHU_EXA_DIRECTIVE = process.env.FEISHU_EXA_DIRECTIVE || '【请使用 exa_search 工具进行联网搜索；给出来源】';
const THINKING_THRESHOLD_MS = Number(process.env.FEISHU_THINKING_THRESHOLD_MS ?? 0);
const THINKING_MODE = String(process.env.FEISHU_THINKING_MODE || 'append');
// 流式进度推送: 每隔多少ms更新一次飞书消息 (0=关闭)
const STREAM_UPDATE_INTERVAL_MS = parseInt(process.env.FEISHU_STREAM_INTERVAL || '3000', 10); // append | update | none
const THINKING_ALWAYS = String(process.env.FEISHU_THINKING_ALWAYS || '1') === '1';
const FORCE_TEXT_REPLY = String(process.env.FEISHU_FORCE_TEXT || '0') === '1';
const FORCE_CARD_REPLY = String(process.env.FEISHU_FORCE_CARD || '1') === '1';
const CARD_WIDE_SCREEN = String(process.env.FEISHU_CARD_WIDE || '1') === '1';
const FORCE_POST_REPLY = String(process.env.FEISHU_FORCE_POST || '0') === '1';
const FEISHU_TABLE_ENABLED = String(process.env.FEISHU_TABLE_ENABLED || '1') === '1';
const FEISHU_TABLE_DATA_TYPE = String(process.env.FEISHU_TABLE_DATA_TYPE || 'lark_md');
const FEISHU_TABLE_ROW_HEIGHT = String(process.env.FEISHU_TABLE_ROW_HEIGHT || 'auto');
const FEISHU_TABLE_ROW_MAX_HEIGHT = String(process.env.FEISHU_TABLE_ROW_MAX_HEIGHT || '');
const FEISHU_TABLE_FREEZE_FIRST_COLUMN = String(process.env.FEISHU_TABLE_FREEZE_FIRST_COLUMN || '0') === '1';
const FEISHU_BODY_PADDING = String(process.env.FEISHU_BODY_PADDING || '12px 12px 12px 12px');
const FEISHU_BODY_H_SPACING = String(process.env.FEISHU_BODY_H_SPACING || 'medium');
const FEISHU_BODY_V_SPACING = String(process.env.FEISHU_BODY_V_SPACING || 'medium');
const FEISHU_BODY_H_ALIGN = String(process.env.FEISHU_BODY_H_ALIGN || 'left');
const FEISHU_BODY_V_ALIGN = String(process.env.FEISHU_BODY_V_ALIGN || 'top');
const FEISHU_CODE_SEND_MODE = String(process.env.FEISHU_CODE_SEND_MODE || 'html'); // html | zip | both | none
const FEISHU_CODE_SEARCH_DIRS = (process.env.FEISHU_CODE_SEARCH_DIRS || `${process.cwd()},${path.join(os.homedir(), 'clawd')},/tmp`)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const FEISHU_CODE_SCAN_MINUTES = Number(process.env.FEISHU_CODE_SCAN_MINUTES || 60);
const FEISHU_CODE_ZIP_MAX_MB = Number(process.env.FEISHU_CODE_ZIP_MAX_MB || 20);
const LONG_REPLY_TO_FILE = String(process.env.FEISHU_LONG_REPLY_TO_FILE || '1') === '1';
const LONG_REPLY_CHARS = Number(process.env.FEISHU_LONG_REPLY_CHARS || 1800);
const LONG_REPLY_PREFIX = String(process.env.FEISHU_LONG_REPLY_PREFIX || 'clawdbot-reply');
const LONG_REPLY_MAX_CHUNKS = Number(process.env.FEISHU_LONG_REPLY_MAX_CHUNKS || 8);
const FEISHU_GROUP_MENTION_ONLY = String(process.env.FEISHU_GROUP_MENTION_ONLY || '0') === '1';
// In group chats, only respond when explicitly invoked (mention the bot, or use a clear prefix).
// This avoids embarrassing "self-trigger" when users @ other people.
const FEISHU_BOT_MENTION_NAMES = (process.env.FEISHU_BOT_MENTION_NAMES || 'clawdt,clawdbot,openclaw,机器人,助手,智能体')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);
const FEISHU_BOT_OPEN_ID = String(process.env.FEISHU_BOT_OPEN_ID || '').trim();
const FEISHU_BOT_USER_ID = String(process.env.FEISHU_BOT_USER_ID || '').trim();
const FEISHU_SESSION_VERSION = String(process.env.FEISHU_SESSION_VERSION || '').trim();

const AIHUBMIX_API_KEY = (() => {
  try {
    return process.env.AIHUBMIX_API_KEY || fs.readFileSync(resolve('~/.clawdbot/secrets/aihubmix_api_key'), 'utf8').trim();
  } catch { return ''; }
})();
const AIHUBMIX_BASE_URL = 'https://aihubmix.com/v1';

// OpenAI-compatible API config (works for OpenAI itself and many proxies, including AIHubMix).
// Keep backwards compatibility:
// - If AI_API_KEY is set, it will be used.
// - Else fall back to AIHUBMIX_API_KEY / ~/.clawdbot/secrets/aihubmix_api_key.
const AI_API_BASE_URL = String(process.env.AI_API_BASE_URL || AIHUBMIX_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/,'');
const AI_API_KEY = (() => {
  try {
    const envKey = String(process.env.AI_API_KEY || '').trim();
    if (envKey) return envKey;
    const f = resolve('~/.clawdbot/secrets/ai_api_key');
    if (fs.existsSync(f)) {
      const k = fs.readFileSync(f, 'utf8').trim();
      if (k) return k;
    }
    return String(AIHUBMIX_API_KEY || '').trim();
  } catch {
    return String(AIHUBMIX_API_KEY || '').trim();
  }
})();

const STT_MODEL = String(process.env.STT_MODEL || 'whisper-1').trim();
const TTS_MODEL = String(process.env.TTS_MODEL || 'tts-1').trim();
const TTS_VOICE = String(process.env.TTS_VOICE || 'nova').trim();
const IMAGE_GEN_PROVIDER = String(process.env.IMAGE_GEN_PROVIDER || 'openai').trim(); // openai | aihubmix_doubao
const IMAGE_GEN_MODEL = String(process.env.IMAGE_GEN_MODEL || 'gpt-image-1').trim();
const IMAGE_GEN_SIZE = String(process.env.IMAGE_GEN_SIZE || '1024x1024').trim();

function resolve(p) { return p.replace(/^~/, os.homedir()); }

function extractUrls(text) {
  const src = String(text || '');
  const re = /https?:\/\/[^\s<>()\]\}]+/g;
  const urls = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    let u = m[0];
    // Trim trailing punctuation commonly attached in chat.
    u = u.replace(/[),.。!！?？;；]+$/g, '');
    urls.push(u);
  }
  // Dedupe, keep order
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function looksLikeOnlyUrls(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const urls = extractUrls(t);
  if (!urls.length) return false;
  // Remove urls and common separators; if nothing left, treat as "url-only".
  let rest = t;
  for (const u of urls) rest = rest.split(u).join(' ');
  rest = rest.replace(/[\s,，;；|]+/g, '').trim();
  return rest.length === 0;
}

function detectLinkRoute(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { matched: false, urls: [] };
  const lower = trimmed.toLowerCase();
  for (const prefix of FEISHU_LINK_PREFIXES) {
    const p = String(prefix || '');
    if (!p) continue;
    if (lower.startsWith(p.toLowerCase())) {
      const rest = trimmed.slice(p.length).trim();
      return { matched: true, urls: extractUrls(rest) };
    }
  }
  return { matched: false, urls: extractUrls(trimmed) };
}

function parseLinksToMarkdown(urls) {
  const list = Array.isArray(urls) ? urls.slice(0, FEISHU_LINK_MAX_URLS) : [];
  if (!list.length) return '';
  if (!fs.existsSync(LINKPARSER_SCRIPT)) {
    return [
      '# 链接解析未配置',
      '',
      `- 期望脚本路径: ${LINKPARSER_SCRIPT}`,
      '',
      '请将 `link-parser/parse_link.py` 放到项目目录，并在 `.env` 中设置：',
      '',
      '- `LINKPARSER_SCRIPT=/absolute/path/to/parse_link.py`',
      '- `LINKPARSER_PY=/absolute/path/to/python`（推荐 venv）',
    ].join('\n');
  }
  const parts = [];
  for (const url of list) {
    const r = spawnSync(
      LINKPARSER_PY,
      [LINKPARSER_SCRIPT, url, '--max-chars', String(FEISHU_LINK_MAX_CHARS)],
      { timeout: FEISHU_LINK_TIMEOUT_MS, encoding: 'utf8' }
    );
    const out = String(r.stdout || '').trim();
    const err = String(r.stderr || '').trim();
    if (out) {
      parts.push(out);
      continue;
    }
    parts.push(`# 链接解析失败\n\n- 来源: ${url}\n\n错误: \`${(err || 'unknown error').slice(0, 800)}\``);
  }
  return parts.join('\n\n---\n\n').trim();
}

function isMentioningBot(mentions) {
  if (!Array.isArray(mentions) || mentions.length === 0) return false;
  for (const m of mentions) {
    if (!m) continue;
    // Some payloads include { id: { open_id/user_id }, name } or other shapes.
    const candidates = [];
    if (typeof m === 'string') candidates.push(m);
    if (typeof m?.name === 'string') candidates.push(m.name);
    if (typeof m?.text === 'string') candidates.push(m.text);
    if (typeof m?.key === 'string') candidates.push(m.key);
    if (typeof m?.id === 'string') candidates.push(m.id);
    if (typeof m?.id === 'object' && m.id) {
      for (const v of Object.values(m.id)) {
        if (typeof v === 'string') candidates.push(v);
      }
    }
    for (const raw of candidates) {
      const s = String(raw || '').trim().toLowerCase().replace(/^@+/, '');
      if (!s) continue;
      if (FEISHU_BOT_OPEN_ID && s === FEISHU_BOT_OPEN_ID.toLowerCase()) return true;
      if (FEISHU_BOT_USER_ID && s === FEISHU_BOT_USER_ID.toLowerCase()) return true;
      for (const n of FEISHU_BOT_MENTION_NAMES) {
        if (s === n || s.includes(n)) return true;
      }
    }
  }
  return false;
}

function mustRead(filePath, label) {
  const resolved = resolve(filePath);
  if (!fs.existsSync(resolved)) { console.error(`[FATAL] ${label} not found: ${resolved}`); process.exit(1); }
  const val = fs.readFileSync(resolved, 'utf8').trim();
  if (!val) { console.error(`[FATAL] ${label} is empty: ${resolved}`); process.exit(1); }
  return val;
}

const uuid = () => crypto.randomUUID();

if (!APP_ID) { console.error('[FATAL] FEISHU_APP_ID environment variable is required'); process.exit(1); }

const APP_SECRET = mustRead(APP_SECRET_PATH, 'Feishu App Secret');
const clawdConfig = JSON.parse(mustRead(CLAWDBOT_CONFIG_PATH, 'Clawdbot config'));
const GATEWAY_PORT = clawdConfig?.gateway?.port || 18789;
const GATEWAY_TOKEN = clawdConfig?.gateway?.auth?.token;

if (!GATEWAY_TOKEN) { console.error('[FATAL] gateway.auth.token missing in Clawdbot config'); process.exit(1); }

const sdkConfig = { appId: APP_ID, appSecret: APP_SECRET, domain: Lark.Domain.Feishu, appType: Lark.AppType.SelfBuild };
const client = new Lark.Client(sdkConfig);
const wsClient = new Lark.WSClient({ ...sdkConfig, loggerLevel: Lark.LoggerLevel.info });

const seen = new Map();
const processing = new Set(); // 正在处理的消息ID
const SEEN_TTL_MS = 10 * 60 * 1000;

const recentMessages = new Map(); // 最近消息内容去重
const CONTENT_DEDUP_WINDOW_MS = 5000; // 5秒内相同内容视为重复

function isDuplicate(messageId, content = '') {
  const now = Date.now();
  
  // 清理过期记录
  for (const [k, ts] of seen) { if (now - ts > SEEN_TTL_MS) seen.delete(k); }
  for (const [k, v] of recentMessages) { if (now - v.ts > CONTENT_DEDUP_WINDOW_MS) recentMessages.delete(k); }
  
  if (!messageId) return false;
  
  // 检查消息ID
  if (seen.has(messageId) || processing.has(messageId)) {
    console.log(`[DUPLICATE] Message ID ${messageId} already seen or processing`);
    return true;
  }
  
  // 检查内容重复（防止消息ID变化但内容相同）
  if (content) {
    const contentHash = content.slice(0, 100); // 取前100字符作为指纹
    if (recentMessages.has(contentHash)) {
      console.log(`[DUPLICATE] Similar content seen ${now - recentMessages.get(contentHash).ts}ms ago`);
      return true;
    }
    recentMessages.set(contentHash, { ts: now, id: messageId });
  }
  
  seen.set(messageId, now);
  processing.add(messageId);
  setTimeout(() => processing.delete(messageId), 300000);
  return false;
}

// 下载飞书语音文件

// ============================================
// 图片处理功能
// ============================================

// 下载飞书图片
async function downloadFeishuImage(messageId, imageKey) {
  try {
    console.log(`[IMAGE] Downloading: messageId=${messageId}, imageKey=${imageKey}`);
    
    const response = await client.im.v1.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type: 'image' }
    });
    
    const tmpFile = path.join('/tmp', `feishu_image_${Date.now()}.png`);
    
    if (response && typeof response.writeFile === 'function') {
      await response.writeFile(tmpFile);
    } else if (response && typeof response.getReadableStream === 'function') {
      const stream = await response.getReadableStream();
      const writeStream = fs.createWriteStream(tmpFile);
      await pipeline(stream, writeStream);
    } else {
      console.log('[IMAGE] Unknown response format');
      return null;
    }
    
    const stats = fs.statSync(tmpFile);
    console.log(`[IMAGE] Downloaded: ${tmpFile} (${stats.size} bytes)`);
    return tmpFile;
  } catch (e) {
    console.error('[ERROR] Download image failed:', e?.message || e);
    return null;
  }
}

// 图片转 base64
function imageToBase64(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  return imageBuffer.toString('base64');
}

// 调用视觉模型理解图片
async function analyzeImage(imagePath, userPrompt = '请描述这张图片') {
  try {
    const base64Image = imageToBase64(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    
    if (!AI_API_KEY) {
      console.error('[IMAGE] AI_API_KEY not configured');
      return null;
    }

    // OpenAI-compatible vision (OpenAI / proxies)
    const response = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',  // 或 'gpt-4o' 或其他视觉模型
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
            ]
          }
        ],
        max_tokens: 1000
      })
    });
    
    const data = await response.json();
    if (data?.choices?.[0]?.message?.content) {
      return data.choices[0].message.content;
    }
    console.error('[IMAGE] Vision API error:', data);
    return null;
  } catch (e) {
    console.error('[ERROR] Analyze image failed:', e?.message || e);
    return null;
  }
}

// ============================================
// 图片生成功能
// ============================================

// 生成图片 (使用 DALL-E 或其他模型)
async function generateImage(prompt) {
  try {
    if (!AI_API_KEY) {
      console.error('[IMAGEGEN] AI_API_KEY not configured');
      return null;
    }

    if (IMAGE_GEN_PROVIDER === 'aihubmix_doubao') {
      console.log(`[IMAGEGEN] Generating (aihubmix_doubao): ${prompt.slice(0, 50)}...`);
      const response = await fetch('https://aihubmix.com/v1/models/doubao/doubao-seedream-4-5/predictions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_API_KEY}`
        },
        body: JSON.stringify({
          input: {
            prompt: prompt,
            size: '2K',
            watermark: false,
            response_format: 'url'
          }
        })
      });

      const data = await response.json();
      if (data?.output?.[0]?.url) {
        const imageUrl = data.output[0].url;
        const imgResponse = await fetch(imageUrl);
        const arrayBuffer = await imgResponse.arrayBuffer();
        const imageBuffer = Buffer.from(arrayBuffer);

        const tmpFile = path.join('/tmp', `generated_${Date.now()}.jpg`);
        fs.writeFileSync(tmpFile, imageBuffer);
        return tmpFile;
      }
      console.error('[IMAGEGEN] API error:', JSON.stringify(data).slice(0, 300));
      return null;
    }

    // Default: OpenAI-compatible Images API.
    console.log(`[IMAGEGEN] Generating (openai): ${prompt.slice(0, 50)}...`);
    const response = await fetch(`${AI_API_BASE_URL}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: IMAGE_GEN_MODEL,
        prompt,
        size: IMAGE_GEN_SIZE
      })
    });
    const data = await response.json();
    const item = data?.data?.[0];
    const tmpFile = path.join('/tmp', `generated_${Date.now()}.png`);

    if (item?.b64_json) {
      fs.writeFileSync(tmpFile, Buffer.from(item.b64_json, 'base64'));
      return tmpFile;
    }
    if (item?.url) {
      const imgResponse = await fetch(item.url);
      const arrayBuffer = await imgResponse.arrayBuffer();
      fs.writeFileSync(tmpFile, Buffer.from(arrayBuffer));
      return tmpFile;
    }

    console.error('[IMAGEGEN] API error:', JSON.stringify(data).slice(0, 300));
    return null;
  } catch (e) {
    console.error('[ERROR] Generate image failed:', e?.message || e);
    return null;
  }
}
// 上传图片到飞书并发送
async function sendImageMessage(chatId, imagePath) {
  try {
    // 使用 ReadStream 上传图片
    const imageStream = fs.createReadStream(imagePath);
    const uploadResp = await client.im.v1.image.create({
      data: {
        image_type: 'message',
        image: imageStream
      }
    });
    
    const imageKey = uploadResp?.data?.image_key || uploadResp?.image_key;
    if (!imageKey) {
      console.error('[IMAGE] Upload failed:', uploadResp);
      return false;
    }
    
    console.log('[IMAGE] Uploaded, key:', imageKey);
    
    // 发送图片消息
    await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'image',
        content: JSON.stringify({ image_key: imageKey })
      }
    });
    
    console.log('[IMAGE] Sent successfully');
    return true;
  } catch (e) {
    console.error('[ERROR] Send image failed:', e?.message || e);
    return false;
  }
}

// ============================================
// 文件处理功能

// 上传文件到飞书并发送
async function sendFileMessage(chatId, filePath, fileName) {
  try {
    console.log(`[FILE] Uploading: ${fileName || filePath}`);
    
    const fileStream = fs.createReadStream(filePath);
    const actualFileName = fileName || path.basename(filePath);
    
    const ext = path.extname(actualFileName).toLowerCase();
    let fileType = 'stream';
    if (['.pdf'].includes(ext)) fileType = 'pdf';
    else if (['.doc', '.docx'].includes(ext)) fileType = 'doc';
    else if (['.xls', '.xlsx'].includes(ext)) fileType = 'xls';
    else if (['.ppt', '.pptx'].includes(ext)) fileType = 'ppt';
    
    const uploadResp = await client.im.v1.file.create({
      data: {
        file_type: fileType,
        file_name: actualFileName,
        file: fileStream
      }
    });
    
    const fileKey = uploadResp?.data?.file_key || uploadResp?.file_key;
    if (!fileKey) {
      console.error('[FILE] Upload failed:', uploadResp);
      return false;
    }
    
    console.log('[FILE] Uploaded, key:', fileKey);
    
    await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'file',
        content: JSON.stringify({ file_key: fileKey })
      }
    });
    
    console.log('[FILE] Sent successfully:', actualFileName);
    return true;
  } catch (e) {
    console.error('[ERROR] Send file failed:', e?.message || e);
    return false;
  }
}

// ============================================

// 下载飞书文件
async function downloadFeishuFile(messageId, fileKey, fileName) {
  try {
    console.log(`[FILE] Downloading: ${fileName}`);
    
    const response = await client.im.v1.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type: 'file' }
    });
    
    const ext = path.extname(fileName) || '.bin';
    const tmpFile = path.join('/tmp', `feishu_file_${Date.now()}${ext}`);
    
    if (response && typeof response.writeFile === 'function') {
      await response.writeFile(tmpFile);
    } else if (response && typeof response.getReadableStream === 'function') {
      const stream = await response.getReadableStream();
      const writeStream = fs.createWriteStream(tmpFile);
      await pipeline(stream, writeStream);
    } else {
      return null;
    }
    
    console.log(`[FILE] Downloaded: ${tmpFile}`);
    return tmpFile;
  } catch (e) {
    console.error('[ERROR] Download file failed:', e?.message || e);
    return null;
  }
}

// 提取文件文本内容
async function extractFileContent(filePath, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  
  try {
    // 纯文本文件
    if (['.txt', '.md', '.json', '.js', '.py', '.sh', '.css', '.html', '.xml', '.csv'].includes(ext)) {
      return fs.readFileSync(filePath, 'utf8').slice(0, 10000);
    }
    
    // PDF 文件 - 使用 pdftotext
    if (ext === '.pdf') {
      try {
        const text = execSync(`pdftotext -layout "${filePath}" -`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        return text.slice(0, 10000);
      } catch {
        return '[PDF 解析失败，请确保安装了 poppler-utils]';
      }
    }
    
    // Word 文档
    if (['.docx', '.doc'].includes(ext)) {
      try {
        // 尝试用 pandoc
        const text = execSync(`pandoc "${filePath}" -t plain`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        return text.slice(0, 10000);
      } catch {
        return '[Word 文档解析失败，请确保安装了 pandoc]';
      }
    }
    
    return `[不支持的文件类型: ${ext}]`;
  } catch (e) {
    console.error('[ERROR] Extract file content:', e?.message);
    return '[文件内容提取失败]';
  }
}

// 检测是否是图片生成请求
function isImageGenRequest(text) {
  // 排除问句
  if (/[?？]$/.test(text) || /怎么|如何|什么|为什么/.test(text)) return false;
  const patterns = [
    /^(画|生成|创建|制作|设计)(一个|一张|一幅|一只|个|张|幅|只)?/,
    /^(帮我|请|能否|可以).*(画|生成|创建)/,
    /generate\s*(an?\s+)?image/i,
    /draw\s*(me\s+)?(a|an)?/i,
    /create\s*(an?\s+)?picture/i
  ];
  return patterns.some(p => p.test(text));
}

// 提取图片生成提示词
function extractImagePrompt(text) {
  // 移除常见的请求前缀
  return text
    .replace(/^(画|生成|创建|制作|设计|帮我|请|能否|可以)(一张|一幅|一个|个)?/g, '')
    .replace(/(图|图片|图像|画|照片)$/g, '')
    .trim() || text;
}


// 检测是否是文件发送请求
function isFileSendRequest(text) {
  const patterns = [
    /^["']?(发送|发|给我|传|分享).*(文件|pdf|ppt|pptx|doc|docx|xls|xlsx|md)/i,
    /把.*(文件|报告|文档).*(发|给|传|分享)/,
    /(文件|报告|文档).*(发给我|发过来|传给我|分享给我)/
  ];
  return patterns.some(p => p.test(text));
}

// 提取文件路径
function extractFilePath(text) {
  // 匹配路径
  const pathMatch = text.match(/[~\/][^\s,，。！]+\.(pdf|pptx?|docx?|xlsx?|md)/i);
  if (pathMatch) {
    return pathMatch[0].replace(/^~/, process.env.HOME || os.homedir());
  }
  
  // 匹配文件名（在 ~/clawd/ 目录查找）
  const nameMatch = text.match(/([^\s\/]+\.(pdf|pptx?|docx?|xlsx?|md))/i);
  if (nameMatch) {
    const possiblePaths = [
      path.join(os.homedir(), 'clawd', 'reports', nameMatch[1]),
      path.join(os.homedir(), 'clawd', nameMatch[1]),
      path.join(process.cwd(), nameMatch[1]),
      path.join(os.homedir(), nameMatch[1]),
      `/tmp/${nameMatch[1]}`
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p;
    }
  }
  
  // 没有指定文件名时，查找最近生成的文件
  const clawdDirs = [process.cwd(), path.join(os.homedir(), 'clawd'), path.join(os.homedir(), 'clawd', 'reports'), '/tmp'];
  const extensions = ['.pdf', '.pptx', '.docx', '.xlsx', '.md'];
  try {
    const files = clawdDirs.flatMap(dir => { try { return fs.readdirSync(dir).map(f => ({ dir, name: f })); } catch { return []; } })
      .filter(f => extensions.some(ext => f.name.toLowerCase().endsWith(ext)))
      .map(f => ({ name: f.name, path: path.join(f.dir, f.name), mtime: fs.statSync(path.join(f.dir, f.name)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    
    if (files.length > 0) {
      // 返回最近修改的文件（30分钟内）
      const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
      const recentFile = files.find(f => f.mtime.getTime() > thirtyMinAgo);
      if (recentFile) {
        console.log(`[FILE] Auto-detected recent file: ${recentFile.path}`);
        return recentFile.path;
      }
    }
  } catch (e) {
    console.error('[FILE] Error finding recent file:', e.message);
  }
  
  return null;
}

function normalizeMarkdownForPost(text) {
  if (!text) return '';
  let processed = text
    .replace(/^#### (.+)$/gm, '【$1】')
    .replace(/^### (.+)$/gm, '【$1】')
    .replace(/^## (.+)$/gm, '【$1】')
    .replace(/^# (.+)$/gm, '【$1】')
    .replace(/^---$/gm, '——————————');

  processed = convertTablesToList(processed);
  return processed;
}

function convertTablesToList(text) {
  if (!text) return '';
  // 简单表格转列表（避免飞书表格渲染问题）
  const lines = text.split('\n');
  const out = [];
  let headers = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').filter(c => c.trim()).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) {
        continue;
      }
      if (!headers) {
        headers = cells;
        continue;
      }
      const parts = [];
      cells.forEach((cell, idx) => {
        const key = headers[idx];
        if (key && cell) parts.push(`${key}: ${cell}`);
        else if (cell) parts.push(cell);
      });
      if (parts.length) out.push('• ' + parts.join(' | '));
      continue;
    }
    headers = null;
    out.push(line);
  }
  return out.join('\n');
}

function extractTextFromPostContent(raw) {
  if (!raw) return '';
  let data = raw;
  try {
    if (typeof raw === 'string') data = JSON.parse(raw);
  } catch {
    return '';
  }
  const post = data?.post || data?.post_content || data?.content?.post || data?.content?.post_content;
  if (!post) return '';
  const langBlock = post.zh_cn || post.en_us || post['zh_CN'] || post['en_US'] || Object.values(post)[0];
  if (!langBlock) return '';
  const lines = [];
  if (langBlock.title) lines.push(langBlock.title);
  const content = Array.isArray(langBlock.content) ? langBlock.content : [];
  for (const row of content) {
    if (!Array.isArray(row)) continue;
    let line = '';
    for (const node of row) {
      if (!node) continue;
      if (node.tag === 'text') line += node.text || '';
      else if (node.tag === 'a') line += node.text || node.href || '';
      else if (node.tag === 'at') line += node.user_name ? `@${node.user_name}` : '@用户';
      else if (node.tag === 'img') line += '[图片]';
      else if (node.text) line += node.text;
    }
    if (line.trim()) lines.push(line);
  }
  return lines.join('\n').trim();
}

function isTableRow(line) {
  const trimmed = (line || '').trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
  const cells = trimmed.split('|').filter(c => c.trim() !== '');
  return cells.length >= 2;
}

function isTableSeparator(line) {
  const trimmed = (line || '').trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
  const cells = trimmed.split('|').filter(c => c.trim() !== '').map(c => c.trim());
  return cells.length >= 2 && cells.every(c => /^:?-{3,}:?$/.test(c));
}

function splitTableRow(line) {
  const trimmed = (line || '').trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed.slice(1, -1).split('|').map(c => c.trim());
}

function sanitizeColumnName(name, index, used) {
  let base = (name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  if (!base || !/^[a-z]/.test(base)) base = `col_${index + 1}`;
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${counter++}`;
  }
  used.add(candidate);
  return candidate;
}

function buildTableElement(headers, rows) {
  if (!headers.length || !rows.length) return null;
  const used = new Set();
  const columns = headers.map((h, idx) => ({
    name: sanitizeColumnName(h, idx, used),
    display_name: h || `列${idx + 1}`,
    data_type: FEISHU_TABLE_DATA_TYPE,
    width: 'auto',
    horizontal_align: 'left',
    vertical_align: 'top'
  }));
  const rowObjects = rows.map(cells => {
    const row = {};
    columns.forEach((col, idx) => {
      row[col.name] = (cells[idx] ?? '').toString();
    });
    return row;
  });
  const table = {
    tag: 'table',
    page_size: Math.min(10, Math.max(1, rowObjects.length)),
    row_height: FEISHU_TABLE_ROW_HEIGHT || 'auto',
    header_style: {
      text_align: 'left',
      text_size: 'normal',
      background_style: 'none',
      text_color: 'grey',
      bold: true,
      lines: 1
    },
    columns,
    rows: rowObjects
  };
  if (FEISHU_TABLE_FREEZE_FIRST_COLUMN) table.freeze_first_column = true;
  if ((FEISHU_TABLE_ROW_HEIGHT || '').toLowerCase() === 'auto' && FEISHU_TABLE_ROW_MAX_HEIGHT) {
    table.row_max_height = FEISHU_TABLE_ROW_MAX_HEIGHT;
  }
  return table;
}

function buildCardElements(text) {
  if (!text) return [];
  if (!FEISHU_TABLE_ENABLED) {
    return [{ tag: 'markdown', content: convertTablesToList(text) || ' ' }];
  }
  const lines = text.split('\n');
  const elements = [];
  let buffer = [];
  let tableCount = 0;
  let inCodeFence = false;
  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content) elements.push({ tag: 'markdown', content });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if ((line || '').trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      buffer.push(line);
      continue;
    }
    if (inCodeFence) {
      buffer.push(line);
      continue;
    }
    if (isTableRow(line) && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        rows.push(splitTableRow(lines[j]));
        j++;
      }
      i = j - 1;
      if (headers.length && rows.length) {
        if (tableCount < 5) {
          flush();
          const tableEl = buildTableElement(headers, rows);
          if (tableEl) {
            elements.push(tableEl);
            tableCount += 1;
            continue;
          }
        } else {
          const tableBlock = [line, lines[i + 1], ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
          buffer.push(convertTablesToList(tableBlock));
          continue;
        }
      }
    }
    buffer.push(line);
  }
  flush();
  if (!elements.length) {
    return [{ tag: 'markdown', content: convertTablesToList(text) || ' ' }];
  }
  return elements;
}

function extractHeaderAndBody(text) {
  if (!text) return { title: '', body: '' };
  const lines = text.split('\n');
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) { idx = i; break; }
  }
  if (idx < 0) return { title: '', body: text };
  const first = lines[idx].trim();
  if (!first) return { title: '', body: text };
  if (first.startsWith('```')) return { title: '', body: text };
  if (/^[-*]\\s+/.test(first) || /^\\d+\\.\\s+/.test(first)) return { title: '', body: text };
  if (first.startsWith('|')) return { title: '', body: text };
  let title = '';
  const h = first.match(/^#{1,6}\\s+(.+)$/);
  if (h) {
    title = h[1].trim();
  } else {
    const b = first.match(/^\\*\\*(.+)\\*\\*$/) || first.match(/^__(.+)__$/);
    if (b) {
      title = b[1].trim();
    } else if (first.length <= 80) {
      title = first;
    }
  }
  if (!title) return { title: '', body: text };
  const bodyLines = lines.slice(0, idx).concat(lines.slice(idx + 1));
  while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift();
  return { title, body: bodyLines.join('\n') };
}

function extractProjectPath(text) {
  if (!text) return '';
  const match = text.match(/(?:目录|路径|path|dir)[:：\s]*([~\/][^\s`"']+)/i);
  if (match && match[1]) {
    const candidate = match[1].replace(/^~/, process.env.HOME || '/root');
    if (fs.existsSync(candidate)) return candidate;
  }
  const pathMatch = text.match(/[~\/][^\s`"']+/);
  if (pathMatch) {
    const candidate = pathMatch[0].replace(/^~/, process.env.HOME || '/root');
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function findRecentHtmlFile() {
  const cutoff = Date.now() - FEISHU_CODE_SCAN_MINUTES * 60 * 1000;
  const exts = ['.html', '.htm'];
  const ignoreDirs = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.cache']);
  let best = null;
  const maxDepth = 4;
  
  const walk = (dir, depth) => {
    if (depth < 0) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        walk(p, depth - 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!exts.includes(ext)) continue;
        let st;
        try { st = fs.statSync(p); } catch { continue; }
        if (st.mtimeMs < cutoff) continue;
        if (!best || st.mtimeMs > best.mtimeMs) {
          best = { path: p, mtimeMs: st.mtimeMs, size: st.size };
        }
      }
    }
  };
  
  for (const root of FEISHU_CODE_SEARCH_DIRS) {
    walk(root, maxDepth);
  }
  return best ? best.path : '';
}

function zipProject(dir) {
  try {
    const base = path.basename(dir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join('/tmp', `${base}-${stamp}.zip`);
    const cmd = `zip -r "${out}" "${dir}" -x "*/node_modules/*" "*/.git/*" "*/.next/*" "*/dist/*" "*/build/*"`;
    execSync(cmd, { stdio: 'ignore' });
    return out;
  } catch (e) {
    console.error('[FILE] Zip project failed:', e?.message || e);
    return '';
  }
}

async function maybeSendCodeArtifacts(chatId, reply, targetPath) {
  if (FEISHU_CODE_SEND_MODE === 'none') return;
  let htmlFile = '';
  let projectDir = '';
  
  if (targetPath) {
    const resolved = targetPath.replace(/^~/, process.env.HOME || '/root');
    if (fs.existsSync(resolved)) {
      const st = fs.statSync(resolved);
      if (st.isFile()) {
        if (/\.(html?|zip|tar\.gz)$/i.test(resolved)) htmlFile = resolved;
        projectDir = path.dirname(resolved);
      } else if (st.isDirectory()) {
        projectDir = resolved;
        const indexPath = path.join(resolved, 'index.html');
        if (fs.existsSync(indexPath)) htmlFile = indexPath;
      }
    }
  }
  
  if (!htmlFile) {
    const fromReply = extractFilePath(reply);
    if (fromReply && fs.existsSync(fromReply) && /\.(html?|zip|tar\.gz)$/i.test(fromReply)) {
      htmlFile = fromReply;
      projectDir = path.dirname(fromReply);
    }
  }
  
  if (!htmlFile) {
    const recentHtml = findRecentHtmlFile();
    if (recentHtml) {
      htmlFile = recentHtml;
      projectDir = path.dirname(recentHtml);
    }
  }
  
  if (htmlFile && (FEISHU_CODE_SEND_MODE === 'html' || FEISHU_CODE_SEND_MODE === 'both')) {
    await sendFileMessage(chatId, htmlFile);
  }
  
  if (projectDir && (FEISHU_CODE_SEND_MODE === 'zip' || FEISHU_CODE_SEND_MODE === 'both')) {
    const zipPath = zipProject(projectDir);
    if (zipPath && fs.existsSync(zipPath)) {
      const sizeMb = fs.statSync(zipPath).size / (1024 * 1024);
      if (sizeMb <= FEISHU_CODE_ZIP_MAX_MB) {
        await sendFileMessage(chatId, zipPath);
      } else {
        await client.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: `📦 项目压缩包过大（${sizeMb.toFixed(1)} MB），未发送。可调大 FEISHU_CODE_ZIP_MAX_MB` }) }
        });
      }
    }
  }
}

// 构建飞书 Markdown 卡片消息
function buildMarkdownCard(text) {
  // JSON 2.0 的富文本组件支持标准 Markdown 标题/分割线
  const { title, body } = extractHeaderAndBody(text || '');
  let processed = body || '';

  const elements = buildCardElements(processed);

  const card = {
    schema: '2.0',
    config: { width_mode: CARD_WIDE_SCREEN ? 'fill' : 'compact' },
    body: {
      direction: 'vertical',
      padding: FEISHU_BODY_PADDING,
      horizontal_spacing: FEISHU_BODY_H_SPACING,
      vertical_spacing: FEISHU_BODY_V_SPACING,
      horizontal_align: FEISHU_BODY_H_ALIGN,
      vertical_align: FEISHU_BODY_V_ALIGN,
      elements: elements.length ? elements : [{ tag: 'markdown', content: processed || ' ' }]
    }
  };
  if (title) {
    card.header = { title: { tag: 'plain_text', content: title } };
  }
  return {
    msg_type: 'interactive',
    content: JSON.stringify(card)
  };
}

// 构建飞书 Post(JSON 2.0)消息
function buildPostMessage(text) {
  const processed = normalizeMarkdownForPost(text);
  const lines = processed.split('\n');
  const content = lines.map(line => {
    const safe = line === '' ? ' ' : line;
    return [{ tag: 'text', text: safe, style: [] }];
  });
  const post = {
    post: {
      zh_cn: {
        title: '',
        content: content.length ? content : [[{ tag: 'text', text: ' ', style: [] }]]
      }
    }
  };
  return { msg_type: 'post', content: JSON.stringify(post) };
}

// 判断是否需要用 Markdown 卡片（包含代码块或格式化内容）
function needsMarkdownCard(text) {
  return /```|`[^`]+`|\*\*|__|\[.*\]\(.*\)|^#+\s|^[-*]\s/m.test(text);
}

// 构建消息（自动选择格式）
function buildMessage(text) {
  if (FORCE_TEXT_REPLY) {
    return { msg_type: "text", content: JSON.stringify({ text }) };
  }
  if (FORCE_CARD_REPLY) {
    return buildMarkdownCard(text);
  }
  if (FORCE_POST_REPLY) {
    return buildPostMessage(text);
  }
  if (needsMarkdownCard(text)) {
    return buildMarkdownCard(text);
  }
  return { msg_type: "text", content: JSON.stringify({ text }) };
}

function writeReplyToTempFile(text) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join('/tmp', `${LONG_REPLY_PREFIX}-${stamp}.md`);
    fs.writeFileSync(filePath, text, 'utf8');
    return filePath;
  } catch (e) {
    console.error('[FILE] Write reply file failed:', e?.message || e);
    return '';
  }
}

function splitMarkdownIntoChunks(text, maxChars) {
  const src = (text || '').replace(/\r\n/g, '\n');
  if (!src) return [];
  if (src.length <= maxChars) return [src];

  const lines = src.split('\n');
  const chunks = [];
  let buf = [];
  let bufLen = 0;
  let inFence = false;
  let fenceLine = '```';

  const pushChunk = () => {
    const out = buf.join('\n').trimEnd();
    if (out) chunks.push(out);
    buf = [];
    bufLen = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (!inFence) {
        inFence = true;
        fenceLine = trimmed; // keep language hint if present
      } else {
        inFence = false;
      }
    }

    const extra = line.length + 1;
    const wouldExceed = bufLen + extra > maxChars;

    if (wouldExceed && buf.length > 0) {
      if (inFence) {
        // Close fence so each chunk is valid markdown, then reopen in next chunk.
        buf.push('```');
        pushChunk();
        buf.push(fenceLine);
        bufLen = fenceLine.length + 1;
      } else {
        pushChunk();
      }
    }

    buf.push(line);
    bufLen += extra;

    // Prefer splitting at paragraph boundaries when possible.
    const next = lines[i + 1];
    if (!inFence && bufLen >= Math.floor(maxChars * 0.75) && (next === undefined || next.trim() === '')) {
      pushChunk();
    }
  }

  if (buf.length) pushChunk();

  // Safety: never return an empty list if there was input
  if (!chunks.length) return [src.slice(0, maxChars)];
  return chunks;
}

async function sendLongReplyAsChunks({ chatId, reply, placeholderId }) {
  const chunks = splitMarkdownIntoChunks(reply, LONG_REPLY_CHARS);
  if (chunks.length <= 1) return false;
  if (chunks.length > LONG_REPLY_MAX_CHUNKS) return false;

  // First chunk: update placeholder if possible, else create.
  if (THINKING_MODE === 'update' && placeholderId) {
    await updateMessageWithFallback(placeholderId, buildMessage(chunks[0]), chunks[0]);
  } else {
    await createMessageWithFallback(chatId, buildMessage(chunks[0]), chunks[0]);
  }

  // Remaining chunks: send as follow-ups.
  for (let i = 1; i < chunks.length; i++) {
    await createMessageWithFallback(chatId, buildMessage(chunks[i]), chunks[i]);
  }
  return true;
}

async function createMessageWithFallback(chatId, payload, fallbackText) {
  try {
    await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, ...payload }
    });
    return true;
  } catch (e) {
    console.error(`[ERROR] send failed (${payload?.msg_type || 'unknown'}):`, e?.message || e);
    if (payload?.msg_type !== 'text') {
      try {
        await client.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: fallbackText || '' }) }
        });
        console.log('[OK] Fallback text sent');
        return true;
      } catch (e2) {
        console.error('[ERROR] fallback send failed:', e2?.message || e2);
      }
    }
    return false;
  }
}

async function updateMessageWithFallback(messageId, payload, fallbackText) {
  try {
    await client.im.v1.message.update({
      path: { message_id: messageId },
      data: payload
    });
    return true;
  } catch (e) {
    console.error(`[ERROR] update failed (${payload?.msg_type || 'unknown'}):`, e?.message || e);
    if (payload?.msg_type !== 'text') {
      try {
        await client.im.v1.message.update({
          path: { message_id: messageId },
          data: { msg_type: 'text', content: JSON.stringify({ text: fallbackText || '' }) }
        });
        console.log('[OK] Fallback text updated');
        return true;
      } catch (e2) {
        console.error('[ERROR] fallback update failed:', e2?.message || e2);
      }
    }
    return false;
  }
}
async function downloadFeishuAudio(messageId, fileKey) {
  try {
    console.log(`[AUDIO] Downloading audio: messageId=${messageId}, fileKey=${fileKey}`);
    
    const response = await client.im.v1.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type: 'file' }
    });
    
    const tmpFile = path.join('/tmp', `feishu_audio_${Date.now()}.opus`);
    
    if (response && typeof response.writeFile === 'function') {
      await response.writeFile(tmpFile);
    } else if (response && typeof response.getReadableStream === 'function') {
      const stream = await response.getReadableStream();
      const writeStream = fs.createWriteStream(tmpFile);
      await pipeline(stream, writeStream);
    } else {
      console.log('[AUDIO] Unknown response format:', typeof response, Object.keys(response || {}));
      return null;
    }
    
    const stats = fs.statSync(tmpFile);
    console.log(`[AUDIO] Downloaded to: ${tmpFile} (${stats.size} bytes)`);
    return tmpFile;
  } catch (e) {
    console.error('[ERROR] Download audio failed:', e?.message || e);
    return null;
  }
}

// 语音转文字 (STT)
async function transcribeAudio(audioFile) {
  if (!AI_API_KEY) {
    console.error('[ERROR] AI_API_KEY not configured');
    return null;
  }
  
  try {
    console.log(`[STT] Transcribing: ${audioFile}`);

    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(audioFile)]), path.basename(audioFile) || 'audio.opus');
    form.append('model', STT_MODEL);
    form.append('language', 'zh');
    form.append('response_format', 'text');
    form.append('temperature', '0.2');

    const resp = await fetch(`${AI_API_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AI_API_KEY}` },
      body: form
    });

    const txt = (await resp.text()).trim();
    if (!resp.ok) {
      console.error('[ERROR] Transcribe failed:', txt.slice(0, 500));
      return null;
    }

    console.log(`[STT] Result: ${txt.slice(0, 120)}...`);
    try { fs.unlinkSync(audioFile); } catch {}
    return txt;
  } catch (e) {
    console.error('[ERROR] Transcribe failed:', e?.message || e);
    return null;
  }
}

// 文字转语音 (TTS)
async function textToSpeech(text) {
  if (!AI_API_KEY) {
    console.error('[ERROR] AI_API_KEY not configured');
    return null;
  }
  
  try {
    // 限制文本长度（TTS 有 4096 字符限制）
    const truncatedText = text.slice(0, 4000);
    console.log(`[TTS] Generating speech for: ${truncatedText.slice(0, 50)}...`);
    
    const tmpFile = path.join('/tmp', `tts_${Date.now()}.mp3`);

    const resp = await fetch(`${AI_API_BASE_URL}/audio/speech`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: truncatedText,
        voice: TTS_VOICE,
        response_format: 'mp3'
      })
    });
    const ab = await resp.arrayBuffer();
    if (!resp.ok) {
      const err = Buffer.from(ab).toString('utf8');
      console.error('[ERROR] TTS failed:', err.slice(0, 500));
      return null;
    }
    fs.writeFileSync(tmpFile, Buffer.from(ab));
    
    const stats = fs.statSync(tmpFile);
    if (stats.size < 100) {
      // 文件太小，可能是错误响应
      const content = fs.readFileSync(tmpFile, 'utf8');
      console.error('[ERROR] TTS returned error:', content);
      fs.unlinkSync(tmpFile);
      return null;
    }
    
    console.log(`[TTS] Generated: ${tmpFile} (${stats.size} bytes)`);
    return tmpFile;
  } catch (e) {
    console.error('[ERROR] TTS failed:', e?.message || e);
    return null;
  }
}

// 上传语音到飞书并发送
async function sendVoiceMessage(chatId, audioFile) {
  try {
    console.log(`[VOICE] Uploading audio: ${audioFile}`);
    
    // 获取音频时长（使用 ffprobe）
    let duration = 1000; // 默认 1 秒
    try {
      const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioFile}"`;
      const durationStr = execSync(durationCmd, { encoding: 'utf8', timeout: 10000 }).trim();
      duration = Math.round(parseFloat(durationStr) * 1000);
    } catch (e) {
      console.log('[VOICE] Could not get duration, using default');
    }
    
    // 上传文件到飞书
    const uploadRes = await client.im.v1.file.create({
      data: {
        file_type: 'opus',
        file_name: 'voice.opus',
        duration: String(duration),
        file: fs.createReadStream(audioFile)
      }
    });
    
    const fileKey = uploadRes?.data?.file_key;
    if (!fileKey) {
      console.error('[ERROR] Upload failed, no file_key');
      return false;
    }
    
    console.log(`[VOICE] Uploaded, file_key: ${fileKey}`);
    
    // 发送语音消息
    await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'audio',
        content: JSON.stringify({ file_key: fileKey })
      }
    });
    
    console.log('[VOICE] Voice message sent');
    
    // 清理临时文件
    try { fs.unlinkSync(audioFile); } catch {}
    
    return true;
  } catch (e) {
    console.error('[ERROR] Send voice failed:', e?.message || e);
    return false;
  }
}

async function askClawdbot({ text, sessionKey, agentId, onDelta }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${GATEWAY_PORT}`);
    let runId = null, buf = '';
    const close = () => { try { ws.close(); } catch {} };
    ws.on('error', (e) => { close(); reject(e); });
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        ws.send(JSON.stringify({ type: 'req', id: 'connect', method: 'connect', params: { minProtocol: 3, maxProtocol: 3, client: { id: 'gateway-client', version: '0.2.0', platform: 'linux', mode: 'backend' }, role: 'operator', scopes: ['operator.read', 'operator.write'], auth: { token: GATEWAY_TOKEN }, locale: 'zh-CN', userAgent: 'feishu-clawdbot-bridge' } }));
        return;
      }
      if (msg.type === 'res' && msg.id === 'connect') {
        if (!msg.ok) { close(); reject(new Error(msg.error?.message || 'connect failed')); return; }
        ws.send(JSON.stringify({ type: 'req', id: 'agent', method: 'agent', params: { message: text, agentId: agentId || CLAWDBOT_AGENT_ID, sessionKey, deliver: false, idempotencyKey: uuid() } }));
        return;
      }
      if (msg.type === 'res' && msg.id === 'agent') {
        if (!msg.ok) { close(); reject(new Error(msg.error?.message || 'agent error')); return; }
        if (msg.payload?.runId) runId = msg.payload.runId;
        return;
      }
      if (msg.type === 'event' && msg.event === 'agent') {
        const p = msg.payload;
        if (!p || (runId && p.runId !== runId)) return;
        if (p.stream === 'assistant') { const d = p.data || {}; if (typeof d.text === 'string') buf = d.text; else if (typeof d.delta === 'string') buf += d.delta; if (onDelta) { try { onDelta(buf); } catch(e) { /* ignore */ } } return; }
        if (p.stream === 'lifecycle') { if (p.data?.phase === 'end') { close(); resolve(buf.trim()); } if (p.data?.phase === 'error') { close(); reject(new Error(p.data?.message || 'agent error')); } }
      }
    });
  });
}

function shouldRespondInGroup(text, mentions) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;

  // If in mention-only mode, only respond when the bot itself is mentioned.
  if (FEISHU_GROUP_MENTION_ONLY) return isMentioningBot(mentions);

  // Default: explicit invocation only.
  // 1) Mentioning the bot.
  if (isMentioningBot(mentions)) return true;

  // 2) Explicit prefixes (code/search routes) or wakewords.
  if (detectCodeRoute(trimmed).matched) return true;
  if (detectSearchRoute(trimmed).matched) return true;
  if (detectLinkRoute(trimmed).matched) return true;
  if (/^(clawdt|clawdbot|openclaw|bot|机器人|助手|智能体)[\s,:，：]/i.test(trimmed)) return true;

  return false;
}

function detectCodeRoute(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { matched: false, text: trimmed };
  for (const prefix of FEISHU_CODE_PREFIXES) {
    if (!prefix) continue;
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
      const rest = trimmed.slice(prefix.length).trim();
      return { matched: true, text: rest };
    }
  }
  return { matched: false, text: trimmed };
}

function detectSearchRoute(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { matched: false, text: trimmed };
  for (const prefix of FEISHU_SEARCH_PREFIXES) {
    if (!prefix) continue;
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
      const rest = trimmed.slice(prefix.length).trim();
      return { matched: true, text: rest };
    }
  }
  return { matched: false, text: trimmed };
}

function isSearchIntent(text) {
  if (!text) return false;
  return /(搜索|查找|查一下|查询|检索|资料|来源|链接|研究|调研|哪里有|怎么找|search|lookup|sources|reference)/i.test(text);
}

async function processMessage(chatId, text, sessionKey, isVoiceInput, agentId, targetPath) {
  let placeholderId = '', done = false;
  const sendThinking = async () => {
    if (done || THINKING_MODE === 'none') return;
    try {
      const res = await client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '🤔 正在思考…' }) }
      });
      placeholderId = res?.data?.message_id || '';
    } catch (e) {
      console.error('[ERROR] send thinking:', e?.message || e);
    }
  };
  
  const timer = (!THINKING_ALWAYS && THINKING_THRESHOLD_MS > 0 && THINKING_MODE !== 'none')
    ? setTimeout(() => { void sendThinking(); }, THINKING_THRESHOLD_MS)
    : null;
  
  if (THINKING_ALWAYS && THINKING_MODE !== 'none') {
    void sendThinking();
  }
  
  let reply = '';
  
  // 检测图片生成请求
  if (agentId !== CLAWDBOT_CODE_AGENT_ID && isImageGenRequest(text)) {
    const prompt = extractImagePrompt(text);
    console.log(`[IMAGEGEN] Detected request: ${prompt}`);
    
    await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '🎨 正在生成图片，请稍候...' }) }
    });
    
    const imagePath = await generateImage(prompt);
    if (imagePath) {
      await sendImageMessage(chatId, imagePath);
      // 清理临时文件
      try { fs.unlinkSync(imagePath); } catch {}
      return;
    } else {
      await client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '❌ 图片生成失败，请重试或换个描述' }) }
      });
      return;
    }
  }

  // 检测文件发送请求
  console.log("[DEBUG] Checking file send:", text, "isFileSendRequest:", isFileSendRequest(text));
  if (isFileSendRequest(text)) {
    const filePath = extractFilePath(text);
    console.log("[DEBUG] extractFilePath result:", filePath);
    if (filePath && fs.existsSync(filePath)) {
      console.log(`[FILE] Detected send request: ${filePath}`);
      
      await client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '📤 正在发送文件...' }) }
      });
      
      const success = await sendFileMessage(chatId, filePath);
      if (success) {
        return;
      } else {
        await client.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '❌ 文件发送失败' }) }
        });
        return;
      }
    }
  }
  try { 
    // 流式进度推送
    let streamBuf = '';
    let lastStreamUpdate = 0;
    let streamTimer = null;
    const doStreamUpdate = async () => {
      if (!streamBuf || !placeholderId || done) return;
      const now = Date.now();
      if (now - lastStreamUpdate < STREAM_UPDATE_INTERVAL_MS) return;
      lastStreamUpdate = now;
      const preview = streamBuf.length > 4000 ? streamBuf.slice(0, 4000) : streamBuf;
      try { await updateMessageWithFallback(placeholderId, buildMessage(preview), preview); } catch (e) { console.error('[STREAM] Update failed:', e?.message); }
    };
    const onDelta = (buf) => {
      streamBuf = buf;
      if (STREAM_UPDATE_INTERVAL_MS > 0 && placeholderId && !done && !streamTimer) {
        streamTimer = setInterval(() => { void doStreamUpdate(); }, STREAM_UPDATE_INTERVAL_MS);
      }
    };
    reply = await askClawdbot({ text, sessionKey, agentId, onDelta });
    if (streamTimer) clearInterval(streamTimer); 
    console.log(`[REPLY] Length: ${reply.length}`);
  } catch (e) { 
    reply = `❌ 系统出错：${e?.message || String(e)}`; 
  } finally { 
    done = true; 
    if (timer) clearTimeout(timer); 
  }
  
  const trimmed = (reply || '').trim();
  if (!trimmed || trimmed === 'NO_REPLY' || trimmed.endsWith('NO_REPLY')) { 
    return; 
  }

  // 长回复自动转文件
  const isCodingRoute = agentId === CLAWDBOT_CODE_AGENT_ID;
  let longReplyFileSent = false;
  if (LONG_REPLY_TO_FILE && reply.length >= LONG_REPLY_CHARS) {
    // For non-coding routes, prefer chunked replies so the user sees content inline (and avoids "double reply" feel).
    if (!isCodingRoute) {
      const chunked = await sendLongReplyAsChunks({ chatId, reply, placeholderId });
      if (chunked) return;
    }

    // Fallback: write to file (useful for very long coding outputs).
    const filePath = writeReplyToTempFile(reply);
    if (filePath) {
      const sent = await sendFileMessage(chatId, filePath);
      if (!sent) {
        await createMessageWithFallback(chatId, buildMessage(reply), reply);
      }
      longReplyFileSent = true;
      if (!isCodingRoute) return;
    }
  }
  
  // 先发送/更新文本消息
  if (!longReplyFileSent) {
    if (THINKING_MODE === 'update' && placeholderId) {
      const ok = await updateMessageWithFallback(placeholderId, buildMessage(reply), reply);
      if (ok) console.log('[OK] Message updated');
    } else {
      const ok = await createMessageWithFallback(chatId, buildMessage(reply), reply);
      if (ok) console.log('[OK] Text sent');
    }
  }
  
  // 如果用户发的是语音，也回复语音
  if (isVoiceInput && reply.length < 2000) {
    try {
      const audioFile = await textToSpeech(reply);
      if (audioFile) {
        await sendVoiceMessage(chatId, audioFile);
      }
    } catch (e) {
      console.error('[ERROR] Voice reply failed:', e?.message || e);
    }
  }

  // 检测并发送 clawdbot 生成的文件
  const filePatterns = [
    /(?:已生成|已创建|已保存|生成了|创建了|保存到|文件路径|输出到)[：:\s]*[`"']?([\/~][^\s`"']+\.(pdf|docx?|xlsx?|pptx?|md))[`"']?/gi,
    /[`"']([\/~][^\s`"']+\.(pdf|docx?|xlsx?|pptx?|md))[`"']/gi
  ];
  
  const foundFiles = new Set();
  for (const pattern of filePatterns) {
    let match;
    while ((match = pattern.exec(reply)) !== null) {
      let filePath = match[1].replace(/^~/, process.env.HOME || '/root');
      foundFiles.add(filePath);
    }
  }
  
  // 发送找到的文件
  for (const filePath of foundFiles) {
    try {
      if (fs.existsSync(filePath)) {
        console.log(`[FILE] Detected generated file: ${filePath}`);
        await sendFileMessage(chatId, filePath);
      }
    } catch (e) {
      console.error(`[FILE] Failed to send ${filePath}:`, e?.message);
    }
  }

  if (isCodingRoute) {
    await maybeSendCodeArtifacts(chatId, reply, targetPath);
  }
}

const dispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    try {
      const { message } = data;
      const chatId = message?.chat_id;
      const messageId = message?.message_id;
      const messageType = message?.message_type;
      const chatType = message?.chat_type || '';
      const senderId = data?.sender?.sender_id || {};
      const senderOpenId = senderId?.open_id || '';
      const senderUserId = senderId?.user_id || '';
      const senderUnionId = senderId?.union_id || '';

      // Persist last-seen p2p chat so we can safely send private test messages without hardcoding IDs.
      // Written only for non-group chats.
      if (chatId && chatType && chatType !== 'group') {
        try {
          fs.writeFileSync('/tmp/feishu_last_chat.json', JSON.stringify({
            ts: Date.now(),
            chat_id: chatId,
            chat_type: chatType,
            sender_open_id: senderOpenId,
            sender_user_id: senderUserId,
            sender_union_id: senderUnionId
          }, null, 2));
        } catch {}
      }
      
      // 先解析内容用于去重
      let text = '';
      if (messageType === 'text' && message?.content) {
        text = (JSON.parse(message.content)?.text || '').trim();
      } else if (messageType === 'post' && message?.content) {
        text = extractTextFromPostContent(message.content);
      }
      
      console.log(`[RECV] chatType=${chatType}, chatId=${String(chatId || '').slice(-12)}, type=${messageType}, id=${messageId?.slice(-12)}, text=${text.slice(0, 30)}...`);
      
      // 去重检查
      const contentPreview = text?.slice(0, 100) || '';
      if (!chatId || isDuplicate(messageId, contentPreview)) {
        console.log(`[SKIP] Duplicate or no chatId`);
        return;
      }
      
      console.log(`[PROCESS] Processing message...`);
      
      let isVoiceInput = false;
      
      // 语音消息特殊处理（需要下载和转录）
      if (messageType === 'audio' && message?.content) {
        isVoiceInput = true;
        const audioContent = JSON.parse(message.content);
        const fileKey = audioContent?.file_key;
        if (fileKey) {
          console.log(`[MSG] Received audio message: ${fileKey}`);
          
          const audioFile = await downloadFeishuAudio(messageId, fileKey);
          if (audioFile) {
            const transcribed = await transcribeAudio(audioFile);
            if (transcribed) {
              text = transcribed;
              console.log(`[STT] Transcribed text: ${text.slice(0, 50)}...`);
            } else {
              await client.im.v1.message.create({ 
                params: { receive_id_type: 'chat_id' }, 
                data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '❌ 语音识别失败，请重试或发送文字消息' }) } 
              });
              return;
            }
          } else {
            await client.im.v1.message.create({ 
              params: { receive_id_type: 'chat_id' }, 
              data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '❌ 语音下载失败，请重试' }) } 
            });
            return;
          }
        }
      }
      else if (messageType === 'image' && message?.content) {
        // 处理图片消息
        const imageContent = JSON.parse(message.content);
        const imageKey = imageContent?.image_key;
        if (imageKey) {
          console.log(`[MSG] Received image: ${imageKey}`);
          
          await client.im.v1.message.create({
            params: { receive_id_type: 'chat_id' },
            data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '🔍 正在分析图片...' }) }
          });
          
          const imageFile = await downloadFeishuImage(messageId, imageKey);
          if (imageFile) {
            const analysis = await analyzeImage(imageFile, '请详细描述这张图片的内容。如果有文字请识别出来。');
            if (analysis) {
              text = `[用户发送了图片]\n图片分析：${analysis}\n\n请基于分析结果回复。`;
            } else {
              await client.im.v1.message.create({
                params: { receive_id_type: 'chat_id' },
                data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '❌ 图片分析失败' }) }
              });
              return;
            }
          } else {
            await client.im.v1.message.create({
              params: { receive_id_type: 'chat_id' },
              data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '❌ 图片下载失败' }) }
            });
            return;
          }
        }
      }
      else if (messageType === 'file' && message?.content) {
        // 处理文件消息
        const fileContent = JSON.parse(message.content);
        const fileKey = fileContent?.file_key;
        const fileName = fileContent?.file_name || 'unknown';
        if (fileKey) {
          console.log(`[MSG] Received file: ${fileName}`);
          
          await client.im.v1.message.create({
            params: { receive_id_type: 'chat_id' },
            data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '📄 正在处理文件...' }) }
          });
          
          const filePath = await downloadFeishuFile(messageId, fileKey, fileName);
          if (filePath) {
            const fileText = await extractFileContent(filePath, fileName);
            text = `[用户发送了文件: ${fileName}]\n内容摘要：${fileText.slice(0, 2000)}\n\n请基于内容回复。`;
          } else {
            await client.im.v1.message.create({
              params: { receive_id_type: 'chat_id' },
              data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '❌ 文件下载失败' }) }
            });
            return;
          }
        }
      }
      else if (messageType === 'text' || messageType === 'post') {
        // 文本消息已在前面解析，直接继续处理
        console.log(`[MSG] Text message ready: ${text.slice(0, 50)}...`);
      }
      else {
        // 未知消息类型，忽略
        console.log(`[SKIP] Unknown message type: ${messageType}`);
        return;
      }
      
      if (!text) return;
      
      if (message?.chat_type === 'group') {
        const mentions = Array.isArray(message?.mentions) ? message.mentions : [];
        text = text.replace(/@_user_\d+\s*/g, '').trim();
        if (!text || !shouldRespondInGroup(text, mentions)) return;
      }

      // Link parsing: in p2p chats, auto-parse if message is URL-only; otherwise require explicit "link:"-style prefix.
      // In group chats, this will only run after the explicit invocation gate above.
      const linkRoute = detectLinkRoute(text);
      const shouldAutoLink = (message?.chat_type !== 'group') && FEISHU_LINK_AUTO_P2P && looksLikeOnlyUrls(text);
      if ((linkRoute.matched || shouldAutoLink) && linkRoute.urls.length > 0) {
        const md = parseLinksToMarkdown(linkRoute.urls);
        if (md) {
          // Send as chunked markdown if necessary.
          if (LONG_REPLY_TO_FILE && md.length >= LONG_REPLY_CHARS) {
            const chunked = await sendLongReplyAsChunks({ chatId, reply: md, placeholderId: '' });
            if (!chunked) {
              const filePath = writeReplyToTempFile(md);
              if (filePath) await sendFileMessage(chatId, filePath);
            }
          } else {
            await createMessageWithFallback(chatId, buildMessage(md), md);
          }
          return;
        }
      }

      const route = detectCodeRoute(text);
      text = route.text;
      const targetPath = route.matched ? extractProjectPath(text) : '';
      if (!text) {
        await client.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '请在前缀后写清楚要做的编码任务，例如：coding: 修复登录接口超时问题' }) }
        });
        return;
      }
      const searchRoute = route.matched ? { matched: false, text } : detectSearchRoute(text);
      if (searchRoute.matched) {
        text = searchRoute.text;
      }
      const shouldForceExa = !route.matched && (searchRoute.matched || (FEISHU_FORCE_EXA_ON_SEARCH && isSearchIntent(text)));
      if (shouldForceExa) {
        text = `${FEISHU_EXA_DIRECTIVE}\n${text}`;
      }
      
      const agentId = route.matched ? CLAWDBOT_CODE_AGENT_ID : CLAWDBOT_AGENT_ID;
      const baseSessionKey = route.matched
        ? `agent:${CLAWDBOT_CODE_AGENT_ID}:feishu:${chatId}`
        : `feishu:${chatId}`;
      const sessionKey = FEISHU_SESSION_VERSION ? `${baseSessionKey}:v${FEISHU_SESSION_VERSION}` : baseSessionKey;
      console.log(`[MSG] Processing (voice=${isVoiceInput}, agent=${agentId}): ${text.slice(0, 50)}...`);
      
      setImmediate(() => processMessage(chatId, text, sessionKey, isVoiceInput, agentId, targetPath));
    } catch (e) { console.error('[ERROR] message handler:', e); }
  },
});

wsClient.start({ eventDispatcher: dispatcher });
console.log(`[OK] Feishu bridge v4.0 started (appId=${APP_ID}) - Voice + Image + File`);
