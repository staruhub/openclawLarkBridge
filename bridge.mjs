/**
 * Feishu ↔ Clawdbot Bridge (v4.0 - Full Multimedia Support)
 * 
 * 功能特性：
 * - 文字对话（Markdown 卡片渲染）
 * - 语音输入/输出（Whisper STT + TTS）
 * - 图片生成（支持 DALL-E / Seedream 等）
 * - 图片理解（GPT-4o-mini 视觉分析）
 * - 文件收发（PDF/DOCX/XLSX/PPTX）
 * - 群聊智能过滤（只响应 @、提问、请求）
 * 
 * GitHub: https://github.com/pongpong/feishu-clawdbot-bridge
 * License: MIT
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import WebSocket from 'ws';
import 'dotenv/config';

// ============================================
// 配置加载
// ============================================

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET_PATH = resolve(process.env.FEISHU_APP_SECRET_PATH || '~/.clawdbot/secrets/feishu_app_secret');
const CLAWDBOT_CONFIG_PATH = resolve(process.env.CLAWDBOT_CONFIG_PATH || '~/.clawdbot/clawdbot.json');
const CLAWDBOT_AGENT_ID = process.env.CLAWDBOT_AGENT_ID || 'main';
const THINKING_THRESHOLD_MS = Number(process.env.FEISHU_THINKING_THRESHOLD_MS ?? 2500);

// AI API 配置（用于语音、图片等功能）
const AI_API_KEY = (() => {
  try {
    return process.env.AI_API_KEY || fs.readFileSync(resolve('~/.clawdbot/secrets/ai_api_key'), 'utf8').trim();
  } catch { return ''; }
})();
const AI_API_BASE_URL = process.env.AI_API_BASE_URL || 'https://api.openai.com/v1';

// 图片生成模型配置
const IMAGE_GEN_MODEL = process.env.IMAGE_GEN_MODEL || 'dall-e-3';
const IMAGE_GEN_SIZE = process.env.IMAGE_GEN_SIZE || '1024x1024';

// 文件搜索路径
const FILE_SEARCH_PATHS = (process.env.FILE_SEARCH_PATHS || '~/clawd/reports,~/clawd,/tmp').split(',').map(p => resolve(p.trim()));

// ============================================
// 工具函数
// ============================================

function resolve(p) { 
  return p.replace(/^~/, os.homedir()); 
}

function mustRead(filePath, label) {
  const resolved = resolve(filePath);
  if (!fs.existsSync(resolved)) { 
    console.error(`[FATAL] ${label} not found: ${resolved}`); 
    process.exit(1); 
  }
  const val = fs.readFileSync(resolved, 'utf8').trim();
  if (!val) { 
    console.error(`[FATAL] ${label} is empty: ${resolved}`); 
    process.exit(1); 
  }
  return val;
}

const uuid = () => crypto.randomUUID();

// ============================================
// 初始化检查
// ============================================

if (!APP_ID) { 
  console.error('[FATAL] FEISHU_APP_ID environment variable is required'); 
  process.exit(1); 
}

const APP_SECRET = mustRead(APP_SECRET_PATH, 'Feishu App Secret');
const clawdConfig = JSON.parse(mustRead(CLAWDBOT_CONFIG_PATH, 'Clawdbot config'));
const GATEWAY_PORT = clawdConfig?.gateway?.port || 18789;
const GATEWAY_TOKEN = clawdConfig?.gateway?.auth?.token;

if (!GATEWAY_TOKEN) { 
  console.error('[FATAL] gateway.auth.token missing in Clawdbot config'); 
  process.exit(1); 
}

// ============================================
// 飞书 SDK 初始化
// ============================================

const sdkConfig = { 
  appId: APP_ID, 
  appSecret: APP_SECRET, 
  domain: Lark.Domain.Feishu, 
  appType: Lark.AppType.SelfBuild 
};

const client = new Lark.Client(sdkConfig);
const wsClient = new Lark.WSClient({ 
  ...sdkConfig, 
  loggerLevel: Lark.LoggerLevel.info 
});

// ============================================
// 消息去重
// ============================================

const seen = new Map();
const SEEN_TTL_MS = 10 * 60 * 1000;

function isDuplicate(messageId) {
  const now = Date.now();
  // 清理过期记录
  for (const [k, ts] of seen) { 
    if (now - ts > SEEN_TTL_MS) seen.delete(k); 
  }
  if (!messageId) return false;
  if (seen.has(messageId)) return true;
  seen.set(messageId, now);
  return false;
}

// ============================================
// Markdown 卡片构建
// ============================================

function buildMarkdownCard(text) {
  // 飞书卡片不支持标准 Markdown 标题语法，转换为粗体
  let processed = text
    .replace(/^#### (.+)$/gm, '**$1**')
    .replace(/^### (.+)$/gm, '**$1**')
    .replace(/^## (.+)$/gm, '**$1**')
    .replace(/^# (.+)$/gm, '**$1**')
    .replace(/^---$/gm, '——————————');
  
  const card = {
    "config": { "wide_screen_mode": true },
    "elements": [
      {
        "tag": "markdown",
        "content": processed
      }
    ]
  };
  
  return {
    msg_type: "interactive",
    content: JSON.stringify(card)
  };
}

function needsMarkdownCard(text) {
  // 包含代码块、格式化内容时使用卡片
  return /```|`[^`]+`|\*\*|__|\[.*\]\(.*\)|^#+\s|^[-*]\s/m.test(text);
}

function buildMessage(text) {
  if (needsMarkdownCard(text)) {
    return buildMarkdownCard(text);
  }
  return { msg_type: "text", content: JSON.stringify({ text }) };
}

// ============================================
// 语音处理功能
// ============================================

async function downloadFeishuAudio(messageId, fileKey) {
  try {
    console.log(`[AUDIO] Downloading: messageId=${messageId}, fileKey=${fileKey}`);
    
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
      console.log('[AUDIO] Unknown response format');
      return null;
    }
    
    const stats = fs.statSync(tmpFile);
    console.log(`[AUDIO] Downloaded: ${tmpFile} (${stats.size} bytes)`);
    return tmpFile;
  } catch (e) {
    console.error('[ERROR] Download audio failed:', e?.message || e);
    return null;
  }
}

async function transcribeAudio(audioFile) {
  if (!AI_API_KEY) {
    console.error('[ERROR] AI_API_KEY not configured for STT');
    return null;
  }
  
  try {
    // 转换为 mp3 格式（Whisper 更好支持）
    const mp3File = audioFile.replace(/\.\w+$/, '.mp3');
    execSync(`ffmpeg -y -i "${audioFile}" -ar 16000 -ac 1 "${mp3File}"`, { timeout: 30000 });
    
    // 调用 Whisper API
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', fs.createReadStream(mp3File));
    form.append('model', 'whisper-1');
    form.append('language', 'zh');
    
    const response = await fetch(`${AI_API_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AI_API_KEY}`,
        ...form.getHeaders()
      },
      body: form
    });
    
    const data = await response.json();
    
    // 清理临时文件
    try { fs.unlinkSync(audioFile); } catch {}
    try { fs.unlinkSync(mp3File); } catch {}
    
    if (data?.text) {
      console.log(`[STT] Transcribed: ${data.text.slice(0, 50)}...`);
      return data.text;
    }
    
    console.error('[STT] API error:', data);
    return null;
  } catch (e) {
    console.error('[ERROR] Transcribe failed:', e?.message || e);
    return null;
  }
}

async function textToSpeech(text) {
  if (!AI_API_KEY) {
    console.error('[ERROR] AI_API_KEY not configured for TTS');
    return null;
  }
  
  try {
    // 截断过长文本
    const truncatedText = text.slice(0, 4000);
    const tmpFile = path.join('/tmp', `tts_${Date.now()}.opus`);
    
    const cmd = `curl -s -X POST "${AI_API_BASE_URL}/audio/speech" \
      -H "Authorization: Bearer ${AI_API_KEY}" \
      -H "Content-Type: application/json" \
      -d '${JSON.stringify({
        model: 'tts-1',
        input: truncatedText,
        voice: 'nova',
        response_format: 'opus'
      }).replace(/'/g, "'\\''")}' \
      --output "${tmpFile}"`;
    
    execSync(cmd, { timeout: 120000 });
    
    const stats = fs.statSync(tmpFile);
    if (stats.size < 100) {
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

async function sendVoiceMessage(chatId, audioFile) {
  try {
    console.log(`[VOICE] Uploading audio: ${audioFile}`);
    
    // 获取音频时长
    let duration = 1000;
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

// ============================================
// 图片处理功能
// ============================================

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

function imageToBase64(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  return imageBuffer.toString('base64');
}

async function analyzeImage(imagePath, userPrompt = '请描述这张图片') {
  if (!AI_API_KEY) {
    console.error('[ERROR] AI_API_KEY not configured for vision');
    return null;
  }
  
  try {
    const base64Image = imageToBase64(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    
    const response = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
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

async function generateImage(prompt) {
  if (!AI_API_KEY) {
    console.error('[ERROR] AI_API_KEY not configured for image generation');
    return null;
  }
  
  try {
    console.log(`[IMAGEGEN] Generating: ${prompt.slice(0, 50)}...`);
    
    const response = await fetch(`${AI_API_BASE_URL}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: IMAGE_GEN_MODEL,
        prompt: prompt,
        n: 1,
        size: IMAGE_GEN_SIZE,
        response_format: 'b64_json'
      })
    });
    
    const data = await response.json();
    if (data?.data?.[0]?.b64_json) {
      const imageBuffer = Buffer.from(data.data[0].b64_json, 'base64');
      const tmpFile = path.join('/tmp', `generated_${Date.now()}.png`);
      fs.writeFileSync(tmpFile, imageBuffer);
      console.log(`[IMAGEGEN] Generated: ${tmpFile}`);
      return tmpFile;
    }
    console.error('[IMAGEGEN] API error:', data);
    return null;
  } catch (e) {
    console.error('[ERROR] Generate image failed:', e?.message || e);
    return null;
  }
}

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
// ============================================

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

async function extractFileContent(filePath, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  
  try {
    // 纯文本文件
    if (['.txt', '.md', '.json', '.js', '.py', '.sh', '.css', '.html', '.xml', '.csv'].includes(ext)) {
      return fs.readFileSync(filePath, 'utf8').slice(0, 10000);
    }
    
    // PDF 文件
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

async function sendFileMessage(chatId, filePath, fileName) {
  try {
    console.log(`[FILE] Uploading: ${fileName || filePath}`);
    
    const fileStream = fs.createReadStream(filePath);
    const actualFileName = fileName || path.basename(filePath);
    
    // 根据扩展名设置 file_type
    const ext = path.extname(actualFileName).toLowerCase();
    let fileType = 'stream';
    if (['.pdf'].includes(ext)) fileType = 'pdf';
    else if (['.doc', '.docx'].includes(ext)) fileType = 'doc';
    else if (['.xls', '.xlsx'].includes(ext)) fileType = 'xls';
    else if (['.ppt', '.pptx'].includes(ext)) fileType = 'ppt';
    
    // 上传文件
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
    
    // 发送文件消息
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
// 意图检测
// ============================================

function isImageGenerationRequest(text) {
  const patterns = [
    /^(画|生成|创建|制作|绘制|设计|做).*(图|画|图片|图像|海报|插画)/,
    /(图|画|图片|图像|海报|插画).*(画|生成|创建|制作|绘制)/,
    /^画一/,
    /generate\s*(an?\s+)?image/i,
    /draw\s*(me\s+)?(a|an)?/i,
    /create\s*(an?\s+)?picture/i
  ];
  return patterns.some(p => p.test(text));
}

function extractImagePrompt(text) {
  return text
    .replace(/^(画|生成|创建|制作|设计|帮我|请|能否|可以)(一张|一幅|一个|个)?/g, '')
    .replace(/(图|图片|图像|画|照片)$/g, '')
    .trim() || text;
}

function isFileSendRequest(text) {
  const patterns = [
    /^(发送|发|给我|传|上传).*(文件|报告|文档|pdf|pptx?|docx?|xlsx?)/i,
    /(文件|报告|文档|pdf|pptx?|docx?|xlsx?).*(发送|发给|传给|给我)/i,
    /^发送\s+\S+\.(pdf|pptx?|docx?|xlsx?|md)/i
  ];
  return patterns.some(p => p.test(text));
}

function extractFilePath(text) {
  // 1. 匹配明确的文件路径
  const pathMatch = text.match(/[~\/][^\s,，。！]+\.(pdf|pptx?|docx?|xlsx?|md)/i);
  if (pathMatch) {
    const p = resolve(pathMatch[0]);
    if (fs.existsSync(p)) return p;
  }
  
  // 2. 匹配文件名，在多个目录查找
  const nameMatch = text.match(/([^\s\/]+\.(pdf|pptx?|docx?|xlsx?|md))/i);
  if (nameMatch) {
    for (const dir of FILE_SEARCH_PATHS) {
      const p = path.join(dir, nameMatch[1]);
      if (fs.existsSync(p)) return p;
    }
  }
  
  // 3. 没有指定文件名时，返回最近30分钟内生成的文件
  const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
  let newestFile = null;
  let newestTime = 0;
  
  for (const dir of FILE_SEARCH_PATHS) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!/\.(pdf|pptx?|docx?|xlsx?|md)$/i.test(file)) continue;
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs > thirtyMinutesAgo && stat.mtimeMs > newestTime) {
          newestFile = filePath;
          newestTime = stat.mtimeMs;
        }
      }
    } catch {}
  }
  
  return newestFile;
}

// ============================================
// 群聊智能过滤
// ============================================

function shouldRespondInGroup(text, mentions = []) {
  // 被 @ 了
  if (mentions && mentions.length > 0) return true;
  
  // 包含问句特征
  if (/[？?]|吗$|呢$|什么|怎么|如何|为什么|哪|多少|是否|能不能|可以吗/.test(text)) return true;
  
  // 包含请求特征
  if (/^(请|帮|麻烦|能否|可以|想要|需要|希望)/.test(text)) return true;
  
  // 直接称呼
  if (/^(小C|助手|AI|机器人|bot)/i.test(text)) return true;
  
  return false;
}

// ============================================
// Clawdbot Gateway 通信
// ============================================

async function askClawdbot({ text, sessionKey }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${GATEWAY_PORT}`);
    let runId = null, buf = '';
    
    const close = () => { try { ws.close(); } catch {} };
    
    ws.on('error', (e) => { close(); reject(e); });
    
    ws.on('message', (raw) => {
      let msg; 
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      
      // 连接握手
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        ws.send(JSON.stringify({ 
          type: 'req', 
          id: 'connect', 
          method: 'connect', 
          params: { 
            minProtocol: 3, 
            maxProtocol: 3, 
            client: { id: 'gateway-client', version: '0.2.0', platform: 'linux', mode: 'backend' }, 
            role: 'operator', 
            scopes: ['operator.read', 'operator.write'], 
            auth: { token: GATEWAY_TOKEN }, 
            locale: 'zh-CN', 
            userAgent: 'feishu-clawdbot-bridge' 
          } 
        }));
        return;
      }
      
      // 连接成功，发送消息
      if (msg.type === 'res' && msg.id === 'connect') {
        const rid = uuid();
        runId = rid;
        ws.send(JSON.stringify({ 
          type: 'req', 
          id: rid, 
          method: 'messages.create', 
          params: { 
            agentId: CLAWDBOT_AGENT_ID, 
            sessionKey, 
            message: { role: 'user', content: text } 
          } 
        }));
        return;
      }
      
      // 流式响应
      if (msg.type === 'event' && msg.event === 'run.output.text' && msg.data?.runId === runId) {
        buf += msg.data.text || '';
      }
      
      // 响应完成
      if (msg.type === 'event' && msg.event === 'run.completed' && msg.data?.runId === runId) {
        close();
        resolve(buf);
      }
      
      // 响应失败
      if (msg.type === 'event' && msg.event === 'run.failed' && msg.data?.runId === runId) {
        close();
        reject(new Error(msg.data?.error || 'Run failed'));
      }
    });
    
    // 超时处理
    setTimeout(() => { close(); reject(new Error('Timeout')); }, 120000);
  });
}

// ============================================
// 消息发送
// ============================================

async function sendReply(chatId, text) {
  const msg = buildMessage(text);
  await client.im.v1.message.create({
    params: { receive_id_type: 'chat_id' },
    data: { receive_id: chatId, ...msg }
  });
}

async function updateReply(messageId, text) {
  const msg = buildMessage(text);
  await client.im.v1.message.patch({
    path: { message_id: messageId },
    data: msg
  });
}

// ============================================
// 消息处理主逻辑
// ============================================

async function processMessage(event) {
  try {
    const message = event?.message;
    const messageId = message?.message_id;
    const chatId = message?.chat_id;
    const messageType = message?.message_type;
    const chatType = message?.chat_type;
    
    if (!chatId || !messageId) return;
    if (isDuplicate(messageId)) return;
    
    let text = '';
    
    // 处理文本消息
    if (messageType === 'text' && message?.content) {
      const content = JSON.parse(message.content);
      text = content?.text || '';
      
      // 群聊过滤
      if (chatType === 'group') {
        const mentions = message.mentions || [];
        text = text.replace(/@_user_\d+\s*/g, '').trim();
        if (!text || !shouldRespondInGroup(text, mentions)) return;
      }
    }
    // 处理语音消息
    else if (messageType === 'audio' && message?.content) {
      const audioContent = JSON.parse(message.content);
      const fileKey = audioContent?.file_key;
      if (fileKey) {
        console.log(`[MSG] Received audio: ${fileKey}`);
        
        await client.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '🎤 正在识别语音...' }) }
        });
        
        const audioFile = await downloadFeishuAudio(messageId, fileKey);
        if (audioFile) {
          const transcribed = await transcribeAudio(audioFile);
          if (transcribed) {
            text = transcribed;
            console.log(`[STT] Transcribed: ${text}`);
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
    // 处理图片消息
    else if (messageType === 'image' && message?.content) {
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
    // 处理文件消息
    else if (messageType === 'file' && message?.content) {
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
    else {
      return;
    }
    
    if (!text) return;
    
    const sessionKey = `feishu:${chatId}`;
    
    // 检测图片生成请求
    if (isImageGenerationRequest(text)) {
      const prompt = extractImagePrompt(text);
      console.log(`[IMAGEGEN] Detected request: ${prompt}`);
      
      await client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '🎨 正在生成图片，请稍候...' }) }
      });
      
      const imagePath = await generateImage(prompt);
      if (imagePath) {
        await sendImageMessage(chatId, imagePath);
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
    if (isFileSendRequest(text)) {
      const filePath = extractFilePath(text);
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
    
    // 发送 "正在思考" 占位消息
    let placeholderId = '', done = false;
    const timer = THINKING_THRESHOLD_MS > 0 ? setTimeout(async () => {
      if (done) return;
      try { 
        const res = await client.im.v1.message.create({ 
          params: { receive_id_type: 'chat_id' }, 
          data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: '🤔 正在思考…' }) } 
        }); 
        placeholderId = res?.data?.message_id || ''; 
      } catch {}
    }, THINKING_THRESHOLD_MS) : null;
    
    // 调用 Clawdbot
    let reply = '';
    try { 
      reply = await askClawdbot({ text, sessionKey }); 
      console.log(`[REPLY] Length: ${reply.length}`);
    } catch (e) { 
      reply = `❌ 系统出错：${e?.message || String(e)}`; 
    } finally { 
      done = true; 
      if (timer) clearTimeout(timer); 
    }
    
    // 过滤空回复
    const trimmed = (reply || '').trim();
    if (!trimmed || trimmed === 'NO_REPLY' || trimmed.endsWith('NO_REPLY')) { 
      if (placeholderId) { 
        try { await client.im.v1.message.delete({ path: { message_id: placeholderId } }); } catch {} 
      } 
      return; 
    }
    
    // 更新或发送回复
    if (placeholderId) { 
      try { await updateReply(placeholderId, reply); return; } catch {} 
    }
    await sendReply(chatId, reply);
    
    // 语音回复（如果原消息是语音）
    if (messageType === 'audio' && reply.length < 500) {
      try {
        const voiceFile = await textToSpeech(reply);
        if (voiceFile) {
          await sendVoiceMessage(chatId, voiceFile);
        }
      } catch (e) {
        console.error('[ERROR] Voice reply failed:', e?.message);
      }
    }
    
  } catch (e) { 
    console.error('[ERROR] processMessage:', e); 
  }
}

// ============================================
// 启动飞书 WebSocket 监听
// ============================================

const dispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    setImmediate(() => processMessage(data));
    return {};
  },
});

wsClient.start({ eventDispatcher: dispatcher });

console.log(`[OK] Feishu bridge v4.0 started (appId=${APP_ID})`);
console.log(`[OK] Features: Text, Voice, Image, File`);
console.log(`[OK] Gateway: ws://127.0.0.1:${GATEWAY_PORT}`);
