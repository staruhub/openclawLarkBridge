# Link Parser

Turn URLs into Markdown for Feishu.

## What It Does

- YouTube: title/author via oEmbed; transcript via `yt-dlp` if available (may require cookies)
- WeChat (`mp.weixin.qq.com`): extracts `#js_content` and converts to Markdown
- GitHub `blob` links: converts to `raw.githubusercontent.com` and returns Markdown content
- Generic pages: main content extraction via `trafilatura` (fallback to `readability-lxml`)

## Runtime

- Python venv: `./.venv-linkparser`
- Entry: `./link-parser/parse_link.py`

## Usage (CLI)

```bash
./.venv-linkparser/bin/python ./link-parser/parse_link.py "https://example.com"
```

### YouTube Cookies (Optional)

Some environments require signing in to fetch YouTube metadata/subtitles. If you have a cookies file:

```bash
export YTDLP_COOKIES_FILE=/path/to/cookies.txt
```

## Feishu Bridge Integration

Configured in `clawd/feishu-clawdbot-bridge/.env`:

- `FEISHU_LINK_AUTO_P2P=1`: in p2p chats, URL-only messages auto-parse
- `FEISHU_LINK_PREFIXES=link:,链接:,解析:,url:`: explicit parsing in any chat
