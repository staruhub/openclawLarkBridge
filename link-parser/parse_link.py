#!/usr/bin/env python3
"""
Parse a URL into Markdown for Feishu.

Supports:
- YouTube: metadata + transcript (auto-subtitles if available)
- WeChat articles (mp.weixin.qq.com): main content extraction
- Generic web pages: trafilatura extraction (fallback to readability)

This script is designed to be called from the Feishu bridge. It prints Markdown to stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import textwrap
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests


DEFAULT_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _shell(cmd: list[str], timeout: int = 120) -> str:
    out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=timeout)
    return out.decode("utf-8", "ignore")


def _is_youtube(url: str) -> bool:
    host = (urlparse(url).netloc or "").lower()
    return host.endswith("youtube.com") or host == "youtu.be" or host.endswith("m.youtube.com")


def _is_wechat(url: str) -> bool:
    host = (urlparse(url).netloc or "").lower()
    return host.endswith("mp.weixin.qq.com")

def _github_raw_url(url: str) -> str:
    """
    Convert GitHub blob URLs to raw.githubusercontent.com URLs when possible.
    """
    p = urlparse(url)
    host = (p.netloc or "").lower()
    if host != "github.com":
        return ""
    parts = [x for x in (p.path or "").split("/") if x]
    # /{owner}/{repo}/blob/{ref}/{path...}
    if len(parts) >= 5 and parts[2] == "blob":
        owner, repo, _, ref = parts[0], parts[1], parts[2], parts[3]
        rest = "/".join(parts[4:])
        return f"https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{rest}"
    return ""


def _clean_ws(s: str) -> str:
    return re.sub(r"[ \t]+", " ", (s or "").strip())


def _md_escape_title(s: str) -> str:
    return (s or "").replace("\n", " ").strip()


def _truncate(s: str, max_chars: int) -> str:
    s = s or ""
    if len(s) <= max_chars:
        return s
    return s[: max_chars - 1].rstrip() + "…"


def _vtt_to_text(vtt: str) -> str:
    # Very small VTT cleaner: strip headers, timestamps, cue settings.
    lines: list[str] = []
    for raw in vtt.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("WEBVTT"):
            continue
        if "-->" in line:
            continue
        if re.match(r"^[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}$", line):
            continue
        # Common cue settings or tags
        line = re.sub(r"<[^>]+>", "", line)
        line = re.sub(r"&nbsp;", " ", line)
        line = _clean_ws(line)
        if not line:
            continue
        lines.append(line)
    # Deduplicate consecutive repeats (common with captions)
    out: list[str] = []
    prev = ""
    for line in lines:
        if line == prev:
            continue
        out.append(line)
        prev = line
    return "\n".join(out).strip()


def parse_youtube(url: str, max_chars: int) -> str:
    # Use yt-dlp (installed via apt) to get metadata and subtitles.
    # Note: YouTube may require cookies in some environments ("confirm you’re not a bot").
    cookies = os.environ.get("YTDLP_COOKIES_FILE", "").strip()

    ytdlp_base = ["yt-dlp"]
    if cookies:
        ytdlp_base += ["--cookies", cookies]

    def exa_contents_fallback(err: Exception) -> str:
        """
        Optional paid fallback: Exa Contents API.
        If EXA_API_KEY is set, try to fetch text/summary from Exa.
        """
        exa_key = (os.environ.get("EXA_API_KEY") or "").strip()
        if not exa_key:
            return ""

        query = "用中文总结这个 YouTube 页面（标题、简介、要点），输出 5 个要点和一句话结论。"
        try:
            resp = requests.post(
                "https://api.exa.ai/contents",
                headers={"x-api-key": exa_key, "Content-Type": "application/json"},
                json={
                    "urls": [url],
                    "text": True,
                    "summary": {"query": query},
                    # Prefer live crawling when cache misses.
                    "livecrawl": "preferred",
                },
                timeout=25,
            )
            resp.raise_for_status()
            data = resp.json() or {}
            results = data.get("results") or []
            r0 = results[0] if results else {}
            title = r0.get("title") or "YouTube"
            summary = (r0.get("summary") or "").strip()
            text = (r0.get("text") or "").strip()

            md = []
            md.append(f"# {_md_escape_title(title)}")
            md.append("")
            md.append(f"- 来源: {url}")
            md.append(f"- 抓取: {_now_iso()}")
            md.append("")
            md.append("## 摘要（Exa）")
            md.append("")
            md.append(_truncate(summary or "（Exa 未返回摘要）", max_chars))
            if text:
                md.append("")
                md.append("## 页面文本（节选）")
                md.append("")
                md.append(_truncate(text, max_chars))
            md.append("")
            md.append("## 说明")
            md.append("")
            md.append(
                "本机 `yt-dlp` 抓取 YouTube 被登录验证拦截，因此使用 Exa 作为兜底。\n\n"
                f"原始错误: `{_truncate(str(err) or repr(err), 800)}`"
            )
            return "\n".join(md).strip() + "\n"
        except Exception:
            return ""

    meta = {}
    try:
        meta_raw = _shell([*ytdlp_base, "--dump-json", "--skip-download", url], timeout=90)
        meta = json.loads(meta_raw)
    except Exception as e:
        exa_md = exa_contents_fallback(e)
        if exa_md:
            return exa_md

        # Fallback: oEmbed provides title/uploader thumbnail without requiring full page fetch.
        oembed = {}
        try:
            r = requests.get(
                "https://www.youtube.com/oembed",
                params={"url": url, "format": "json"},
                headers={"User-Agent": DEFAULT_UA},
                timeout=15,
            )
            if r.ok:
                oembed = r.json()
        except Exception:
            oembed = {}

        title = oembed.get("title") or "YouTube"
        uploader = oembed.get("author_name") or ""
        md = []
        md.append(f"# {_md_escape_title(title)}")
        md.append("")
        md.append(f"- 来源: {url}")
        if uploader:
            md.append(f"- 频道: {uploader}")
        md.append(f"- 抓取: {_now_iso()}")
        md.append("")
        md.append("## 说明")
        md.append("")
        md.append(
            "当前环境无法直接抓取 YouTube 详情页或字幕（通常会出现“Sign in to confirm you’re not a bot”）。\n\n"
            "可选解决方案：\n"
            "1) 提供 cookies 文件并设置环境变量：`YTDLP_COOKIES_FILE=/path/to/cookies.txt`\n"
            "2) 设置 `EXA_API_KEY`，启用 Exa Contents API 作为兜底解析（标题/简介/页面文本）\n\n"
            f"错误: `{_truncate(str(e) or repr(e), 800)}`"
        )
        return "\n".join(md).strip() + "\n"

    title = meta.get("title") or "YouTube"
    uploader = meta.get("uploader") or meta.get("channel") or ""
    upload_date = meta.get("upload_date") or ""
    duration = meta.get("duration") or 0
    desc = meta.get("description") or ""

    date_str = ""
    if upload_date and re.match(r"^[0-9]{8}$", str(upload_date)):
        date_str = f"{upload_date[0:4]}-{upload_date[4:6]}-{upload_date[6:8]}"

    transcript_text = ""
    # Prefer manual subs, then auto-subs. Try zh first, then en.
    with tempfile.TemporaryDirectory(prefix="linkparse_yt_") as td:
        base = os.path.join(td, "sub")
        # Manual subs
        for lang in ["zh-Hans", "zh-CN", "zh", "en"]:
            try:
                _shell(
                    [
                        *ytdlp_base,
                        "--skip-download",
                        "--write-subs",
                        "--sub-lang",
                        lang,
                        "--sub-format",
                        "vtt",
                        "-o",
                        base + ".%(ext)s",
                        url,
                    ],
                    timeout=120,
                )
                # Find written vtt
                for fn in os.listdir(td):
                    if fn.endswith(".vtt"):
                        vtt = open(os.path.join(td, fn), "r", encoding="utf-8", errors="ignore").read()
                        transcript_text = _vtt_to_text(vtt)
                        break
                if transcript_text:
                    break
            except Exception:
                pass

        # Auto subs if still empty
        if not transcript_text:
            for lang in ["zh-Hans", "zh-CN", "zh", "en"]:
                try:
                    _shell(
                        [
                            *ytdlp_base,
                            "--skip-download",
                            "--write-auto-subs",
                            "--sub-lang",
                            lang,
                            "--sub-format",
                            "vtt",
                            "-o",
                            base + ".%(ext)s",
                            url,
                        ],
                        timeout=120,
                    )
                    for fn in os.listdir(td):
                        if fn.endswith(".vtt"):
                            vtt = open(os.path.join(td, fn), "r", encoding="utf-8", errors="ignore").read()
                            transcript_text = _vtt_to_text(vtt)
                            break
                    if transcript_text:
                        break
                except Exception:
                    pass

    md = []
    md.append(f"# {_md_escape_title(title)}")
    md.append("")
    md.append(f"- 来源: {url}")
    if uploader:
        md.append(f"- 频道: {uploader}")
    if date_str:
        md.append(f"- 日期: {date_str}")
    if duration:
        md.append(f"- 时长: {int(duration)} 秒")
    md.append(f"- 抓取: {_now_iso()}")
    md.append("")

    if transcript_text:
        md.append("## 字幕")
        md.append("")
        md.append(_truncate(transcript_text, max_chars))
    else:
        md.append("## 简介")
        md.append("")
        md.append(_truncate(desc.strip() or "（未获取到字幕，且简介为空）", max_chars))

    return "\n".join(md).strip() + "\n"


def parse_wechat(url: str, max_chars: int) -> str:
    # WeChat pages are mostly static HTML; extract #js_content when possible.
    headers = {"User-Agent": DEFAULT_UA}
    r = requests.get(url, headers=headers, timeout=25)
    r.raise_for_status()
    html = r.text

    # Lazy imports inside venv.
    from bs4 import BeautifulSoup  # type: ignore
    from markdownify import markdownify as mdify  # type: ignore

    soup = BeautifulSoup(html, "lxml")
    title = _clean_ws((soup.title.text if soup.title else "") or "")
    if not title:
        title = "微信文章"

    node = soup.select_one("#js_content") or soup.select_one("article") or soup.body
    if not node:
        text = soup.get_text("\n")
        body_md = _truncate(_clean_ws(text), max_chars)
    else:
        # Remove scripts/styles
        for bad in node.select("script,style,noscript"):
            bad.decompose()
        body_html = str(node)
        body_md = mdify(body_html, heading_style="ATX")
        body_md = body_md.replace("\r\n", "\n").strip()
        body_md = _truncate(body_md, max_chars)

    md = []
    md.append(f"# {_md_escape_title(title)}")
    md.append("")
    md.append(f"- 来源: {url}")
    md.append(f"- 抓取: {_now_iso()}")
    md.append("")
    md.append(body_md if body_md else "（未提取到正文）")
    return "\n".join(md).strip() + "\n"


def parse_generic(url: str, max_chars: int) -> str:
    # Special-case: GitHub markdown/blob pages.
    raw = _github_raw_url(url)
    if raw:
        headers = {"User-Agent": DEFAULT_UA}
        r = requests.get(raw, headers=headers, timeout=25)
        r.raise_for_status()
        body = r.text.replace("\r\n", "\n").strip()
        title_guess = raw.split("/")[-1] or "GitHub 文件"
        md = []
        md.append(f"# {_md_escape_title(title_guess)}")
        md.append("")
        md.append(f"- 来源: {url}")
        md.append(f"- Raw: {raw}")
        md.append(f"- 抓取: {_now_iso()}")
        md.append("")
        md.append(_truncate(body, max_chars))
        return "\n".join(md).strip() + "\n"

    # Primary: trafilatura.
    headers = {"User-Agent": DEFAULT_UA}
    r = requests.get(url, headers=headers, timeout=25)
    r.raise_for_status()
    html = r.text

    title = ""
    try:
        from bs4 import BeautifulSoup  # type: ignore

        soup = BeautifulSoup(html, "lxml")
        title = _clean_ws((soup.title.text if soup.title else "") or "")
    except Exception:
        title = ""

    extracted = ""
    try:
        import trafilatura  # type: ignore

        downloaded = html
        extracted = trafilatura.extract(
            downloaded,
            output_format="markdown",
            include_links=True,
            include_images=False,
            include_tables=True,
            favor_recall=True,
        ) or ""
    except Exception:
        extracted = ""

    if not extracted:
        # Fallback: readability-lxml + markdownify
        try:
            from readability import Document  # type: ignore
            from markdownify import markdownify as mdify  # type: ignore

            doc = Document(html)
            title = title or _clean_ws(doc.short_title() or "")
            content_html = doc.summary(html_partial=True)
            extracted = mdify(content_html, heading_style="ATX").strip()
        except Exception:
            extracted = ""

    extracted = extracted.strip()
    extracted = _truncate(extracted or "（未提取到正文）", max_chars)

    md = []
    md.append(f"# {_md_escape_title(title or '网页内容')}")
    md.append("")
    md.append(f"- 来源: {url}")
    md.append(f"- 抓取: {_now_iso()}")
    md.append("")
    md.append(extracted)
    return "\n".join(md).strip() + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--max-chars", type=int, default=16000)
    args = ap.parse_args()

    url = args.url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        print("[FATAL] url must start with http(s)://", file=sys.stderr)
        return 2

    max_chars = max(2000, int(args.max_chars))

    try:
        if _is_youtube(url):
            out = parse_youtube(url, max_chars=max_chars)
        elif _is_wechat(url):
            out = parse_wechat(url, max_chars=max_chars)
        else:
            out = parse_generic(url, max_chars=max_chars)
        sys.stdout.write(out)
        return 0
    except Exception as e:
        msg = str(e) or repr(e)
        sys.stdout.write(
            textwrap.dedent(
                f"""\
                # 链接解析失败

                - 来源: {url}
                - 时间: {_now_iso()}

                错误: `{_truncate(msg, 800)}`
                """
            ).strip()
            + "\n"
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
