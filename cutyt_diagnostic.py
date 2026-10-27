#!/usr/bin/env python3
"""
cutyt_diagnostic.py — Complete CutYT → FLAC reverse-engineering toolkit.

Modes
-----
  discover <yt_url>   Visible browser (Playwright) — solves Cloudflare,
                      captures the real CutYT API calls + cf_clearance cookie
                      + .flac URLs. Saved to ~/.cutyt_diagnostic.json

  direct   <yt_url>   Replays the captured API call using curl_cffi (Chrome
                      TLS fingerprint) + captured cookies. NO BROWSER.
                      Returns the real FLAC URL if CutYT's API allows replay.

  ytdlp    <yt_url>   Reliable fallback: downloads + transcodes to FLAC via
                      yt-dlp + ffmpeg. NO CutYT, NO browser.

  verify   <file|url> Verifies a FLAC by magic bytes + mutagen + HTTP headers.

  auto     <yt_url>   Tries `direct` once, then falls back to `ytdlp` unless
                      --strict is set (then fails if direct fails).

Install
-------
  pip install requests curl_cffi yt-dlp mutagen
  pip install playwright && playwright install chromium   # only for `discover`

ffmpeg is auto-downloaded on first `ytdlp` run into ~/.cache/cutyt-ffmpeg
"""

import argparse
import json
import os
import re
import shutil
import sys
import time
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import quote

import requests

# ---------- optional dependencies ----------
try:
    import yt_dlp
    HAS_YTDLP = True
except ImportError:
    HAS_YTDLP = False

try:
    from mutagen.flac import FLAC
    HAS_MUTAGEN = True
except ImportError:
    HAS_MUTAGEN = False

try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

# curl_cffi impersonates a real browser TLS fingerprint — required to bypass
# Cloudflare's passive bot checks when replaying the API.
try:
    from curl_cffi import requests as cffi_requests
    HAS_CURL_CFFI = True
except ImportError:
    HAS_CURL_CFFI = False

# ---------- constants ----------
CONFIG_PATH = Path.home() / ".cutyt_diagnostic.json"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
FLAC_MAGIC = b"fLaC"
CUTYT_BASE = "https://www.cutyt.com/download"
CUTYT_ORIGIN = "https://www.cutyt.com"

FFMPEG_CACHE = Path.home() / ".cache" / "cutyt-ffmpeg"
FFMPEG_URL = (
    "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/"
    "latest/ffmpeg-master-latest-win64-gpl.zip"
)


# ============================================================
# Helpers
# ============================================================
def get_video_id(url_or_id: str) -> str:
    if not url_or_id:
        return url_or_id
    m = re.search(r"(?:v=|/)([0-9A-Za-z_-]{11})", url_or_id)
    return m.group(1) if m else url_or_id


def build_yt_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def cutyt_page_url(video_id: str) -> str:
    yt = build_yt_url(video_id)
    return f"{CUTYT_BASE}?url={quote(yt, safe='')}&format=flac&type=audio"


def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text())
        except Exception:
            pass
    return {}


def save_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))


def _pseudo_headers_strip(headers: dict) -> dict:
    skip = {":authority", ":method", ":path", ":scheme",
            "host", "content-length", "connection"}
    out = {}
    for k, v in (headers or {}).items():
        if k.lower() in skip or k.startswith(":"):
            continue
        out[k] = v
    return out


def _find_flac_url_in_json(data) -> str | None:
    """Recursively search any JSON structure for a .flac URL string."""
    if isinstance(data, str):
        if data.startswith("http") and ".flac" in data.lower():
            return data
    elif isinstance(data, dict):
        # Prefer known keys first
        for key in ("url", "download_url", "downloadUrl", "file",
                    "link", "flac", "result", "download"):
            if key in data:
                v = data[key]
                if isinstance(v, str) and v.startswith("http") and ".flac" in v.lower():
                    return v
                nested = _find_flac_url_in_json(v)
                if nested:
                    return nested
        # Fallback: recurse all
        for v in data.values():
            r = _find_flac_url_in_json(v)
            if r:
                return r
    elif isinstance(data, list):
        for v in data:
            r = _find_flac_url_in_json(v)
            if r:
                return r
    return None


def _make_session(cookies_list: list):
    """Build a session with cookies attached. curl_cffi preferred (TLS impersonation)."""
    if HAS_CURL_CFFI:
        s = cffi_requests.Session(impersonate="chrome120")
    else:
        s = requests.Session()
        s.headers.update({"User-Agent": DEFAULT_USER_AGENT})

    for c in cookies_list or []:
        try:
            s.cookies.set(
                c["name"], c["value"],
                domain=c.get("domain") or ".cutyt.com",
                path=c.get("path") or "/",
            )
        except Exception:
            pass
    return s


# ============================================================
# ffmpeg discovery + auto-download
# ============================================================
def _has_both(d: Path) -> bool:
    if not d or not d.is_dir():
        return False
    if os.name == "nt":
        return (d / "ffmpeg.exe").exists() and (d / "ffprobe.exe").exists()
    return (d / "ffmpeg").exists() and (d / "ffprobe").exists()


def _search_known_paths() -> str | None:
    ff = shutil.which("ffmpeg")
    fp = shutil.which("ffprobe")
    if ff and fp:
        return str(Path(ff).parent)

    for cand in [
        r"C:\ffmpeg",
        r"C:\ffmpeg\bin",
        r"C:\ProgramData\chocolatey\bin",
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Links"),
        os.path.expandvars(r"%USERPROFILE%\scoop\shims"),
    ]:
        p = Path(cand)
        if _has_both(p):
            return str(p)

    if _has_both(FFMPEG_CACHE):
        return str(FFMPEG_CACHE)
    for p in FFMPEG_CACHE.rglob("ffprobe.exe" if os.name == "nt" else "ffprobe"):
        if _has_both(p.parent):
            return str(p.parent)

    return None


def find_ffmpeg(auto_download: bool = True) -> str | None:
    found = _search_known_paths()
    if found:
        return found
    if not auto_download:
        return None

    print(f"⬇️  ffmpeg/ffprobe not found — downloading (~120 MB)")
    print(f"    → {FFMPEG_CACHE}")
    FFMPEG_CACHE.mkdir(parents=True, exist_ok=True)
    zip_path = FFMPEG_CACHE / "ffmpeg.zip"

    try:
        urllib.request.urlretrieve(FFMPEG_URL, zip_path)
        print(f"📦 Downloaded {zip_path.stat().st_size / (1024 * 1024):.1f} MB")
    except Exception as e:
        print(f"❌ Download failed: {e}")
        return None

    print("📂 Extracting...")
    try:
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(FFMPEG_CACHE)
    except Exception as e:
        print(f"❌ Extract failed: {e}")
        return None
    finally:
        try:
            zip_path.unlink()
        except Exception:
            pass

    for p in FFMPEG_CACHE.rglob("ffprobe.exe" if os.name == "nt" else "ffprobe"):
        if _has_both(p.parent):
            print(f"✅ ffmpeg ready: {p.parent}")
            return str(p.parent)

    print("❌ Extract succeeded but ffprobe not found in tree.")
    return None


# ============================================================
# 1. FLAC verification
# ============================================================
def verify_local_flac(path: str | Path) -> bool:
    path = Path(path)
    if not path.exists():
        print(f"❌ Not found: {path}")
        return False

    with open(path, "rb") as f:
        head = f.read(4)
    if head != FLAC_MAGIC:
        print(f"❌ Bad magic bytes: {head.hex()} (need 66 4c 61 43)")
        return False
    print("✅ [1/3] Magic bytes: fLaC")

    size_mb = path.stat().st_size / (1024 * 1024)
    print(f"✅ [2/3] Size: {size_mb:.2f} MB")

    if not HAS_MUTAGEN:
        print("⚠️  mutagen not installed — skipping deep parse")
        print("   → pip install mutagen  to enable full verification")
        return True
    try:
        audio = FLAC(str(path))
        print(f"✅ [3/3] Length:       {audio.info.length:.2f} s")
        print(f"         Sample rate:  {audio.info.sample_rate} Hz")
        print(f"         Channels:     {audio.info.channels}")
        print(f"         Bit depth:    {audio.info.bits_per_sample} bit")
        if audio.tags:
            for tag, val in list(audio.tags.items())[:6]:
                print(f"         {tag}: {val}")
        return True
    except Exception as e:
        print(f"❌ Mutagen parse failed: {e}")
        return False


def verify_remote_flac(url: str, cookies_list: list | None = None) -> bool:
    """Verify a remote FLAC by headers + first-4-bytes magic check.
    Uses curl_cffi if available so it works on Cloudflare-fronted URLs."""
    if HAS_CURL_CFFI:
        session = cffi_requests.Session(impersonate="chrome120")
    else:
        session = requests.Session()
        session.headers.update({"User-Agent": DEFAULT_USER_AGENT})

    for c in cookies_list or []:
        try:
            session.cookies.set(c["name"], c["value"],
                                domain=c.get("domain") or ".cutyt.com")
        except Exception:
            pass

    print(f"⏳ HEAD {url}")
    try:
        h = session.head(url, timeout=15, allow_redirects=True)
        print(f"   status        : {h.status_code}")
        print(f"   content-type  : {h.headers.get('content-type')}")
        cl = h.headers.get("content-length")
        if cl:
            try:
                print(f"   content-length: {int(cl) / (1024 * 1024):.2f} MB")
            except Exception:
                pass
    except Exception as e:
        print(f"   ⚠️ HEAD failed ({e}); trying Range GET anyway...")

    print("⏳ GET first 4 bytes (Range: 0-3)")
    try:
        r = session.get(url, stream=True, timeout=15,
                        headers={"Range": "bytes=0-3"})
        print(f"   GET status    : {r.status_code}")
        if r.status_code not in (200, 206):
            print(f"❌ Unexpected status {r.status_code}")
            return False
        first = next(r.iter_content(chunk_size=4), b"")
        if first.startswith(FLAC_MAGIC):
            print("✅ Remote magic bytes: fLaC")
            return True
        print(f"❌ Bad remote magic: {first.hex() if first else 'empty'}")
        return False
    except Exception as e:
        print(f"❌ GET failed: {e}")
        return False


# ============================================================
# 2. DISCOVER — visible browser to solve Cloudflare, capture everything
# ============================================================
def discover(target: str) -> dict:
    if not HAS_PLAYWRIGHT:
        print("❌ Playwright missing. Install:")
        print("   pip install playwright && playwright install chromium")
        return {}

    vid = get_video_id(target)
    cutyt_url = cutyt_page_url(vid)

    bucket = {"xhr": [], "flac_urls": [], "cookies": [], "final_url": None}

    print("=" * 60)
    print("🚀 DISCOVERY MODE — Chrome will open. Cloudflare challenge will be solved.")
    print("=" * 60)
    print(f"🔗 {cutyt_url}\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False, slow_mo=100,
            args=["--window-size=1280,860"],
        )
        ctx = browser.new_context(
            user_agent=DEFAULT_USER_AGENT,
            viewport={"width": 1280, "height": 860},
        )
        page = ctx.new_page()

        def on_request(req):
            t = req.resource_type
            if t in ("xhr", "fetch"):
                entry = {
                    "method": req.method,
                    "url": req.url,
                    "headers": dict(req.headers),
                    "post_data": req.post_data,
                }
                bucket["xhr"].append(entry)
                print(f"[XHR] {req.method:5s} {req.url}")
                if req.post_data:
                    print(f"       payload: {req.post_data[:200]}")
            if ".flac" in req.url.lower():
                print(f"\n🎯 [FLAC] {req.url}\n")
                bucket["flac_urls"].append(req.url)

        def on_response(resp):
            if ".flac" in resp.url.lower() and not bucket["final_url"]:
                bucket["final_url"] = resp.url
                print(f"📥 [FLAC response] {resp.status} {resp.url}")

        page.on("request", on_request)
        page.on("response", on_response)

        try:
            page.goto(cutyt_url, wait_until="domcontentloaded", timeout=30_000)
        except Exception as e:
            print(f"⚠️ Navigation: {e}")

        print("\n⏳ Waiting up to 25s for the FLAC request...")
        for _ in range(25):
            if bucket["flac_urls"] or bucket["final_url"]:
                break
            time.sleep(1)

        try:
            bucket["cookies"] = ctx.cookies()
            cf_clearance = any(c["name"] == "cf_clearance" for c in bucket["cookies"])
            print(f"🍪 Captured {len(bucket['cookies'])} cookies"
                  f" (cf_clearance: {'✅ yes' if cf_clearance else '❌ no'})")
        except Exception:
            pass

        time.sleep(2)
        browser.close()

    cfg = load_config()
    cfg.setdefault("discoveries", {})[vid] = {
        "ts": int(time.time()),
        "xhr": bucket["xhr"],
        "flac_urls": bucket["flac_urls"],
        "cookies": bucket["cookies"],
    }
    save_config(cfg)
    print(f"\n💾 Saved → {CONFIG_PATH}")

    print("\n" + "=" * 60)
    print("📋 DISCOVERY SUMMARY")
    print("=" * 60)
    print(f"XHR/Fetch captured: {len(bucket['xhr'])}")
    for i, e in enumerate(bucket["xhr"], 1):
        print(f"  {i:2d}. {e['method']:5s} {e['url']}")
    print(f"\nFLAC URLs captured: {len(bucket['flac_urls'])}")
    for u in bucket["flac_urls"]:
        print(f"     {u}")

    if bucket["flac_urls"]:
        print("\n🔎 Verifying first captured FLAC URL...")
        verify_remote_flac(bucket["flac_urls"][0], bucket["cookies"])

    print("\n💡 Next steps:")
    print("   - Run: python cutyt_diagnostic.py direct <yt_url>")
    print("     (uses curl_cffi + cf_clearance to replay without a browser)\n")
    return bucket


# ============================================================
# 3. DIRECT — replay CutYT API (no browser) via curl_cffi
# ============================================================
def direct(target: str) -> str | None:
    vid = get_video_id(target)
    cutyt_url = cutyt_page_url(vid)

    cfg = load_config()
    saved = cfg.get("discoveries", {}).get(vid)

    if not saved:
        print("⚠️ No saved discovery for this video.")
        print("   Run `python cutyt_diagnostic.py discover <url>` first.")
        return None

    if not HAS_CURL_CFFI:
        print("⚠️ curl_cffi not installed — Cloudflare will likely block replay.")
        print("   → pip install curl_cffi   (strongly recommended)")

    print(f"📋 Replaying discovery from {time.strftime('%Y-%m-%d %H:%M', time.localtime(saved['ts']))}")
    print(f"🍪 Using {len(saved['cookies'])} saved cookies")

    session = _make_session(saved["cookies"])

    base_headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": CUTYT_ORIGIN,
        "Referer": cutyt_url,
    }

    # ---- Warm-up: hit the CutYT page so the session refreshes cf_clearance ----
    print(f"\n🔥 Warming up session with GET {cutyt_url}")
    try:
        warm = session.get(cutyt_url, headers=base_headers,
                           timeout=20, allow_redirects=True)
        print(f"   → HTTP {warm.status_code}")
        if warm.status_code == 403:
            print("❌ Cloudflare 403 on warm-up.")
            print("   → Re-run `discover` (cf_clearance may have expired).")
            print("   → Also note: cf_clearance is IP-bound; don't switch networks.")
            return None
    except Exception as e:
        print(f"   ⚠️ Warm-up failed: {e}")

    # ---- Collect all POST candidates (in order of likelihood) ----
    posts = [e for e in saved["xhr"] if e["method"] == "POST"]
    def score(e):
        body = (e.get("post_data") or "").lower()
        u = e["url"].lower()
        s = 0
        if "youtube" in body or "youtu.be" in body: s += 3
        if "flac" in body: s += 2
        if "url" in body: s += 1
        if "convert" in u or "download" in u or "api" in u: s += 2
        return -s
    posts.sort(key=score)

    if not posts:
        print("❌ No POST endpoint captured — CutYT may need a full browser.")
    else:
        print(f"\n🎯 Trying {len(posts)} captured POST endpoint(s)...")

    for i, cand in enumerate(posts, 1):
        url = cand["url"]
        payload = cand.get("post_data") or ""
        headers = {**base_headers, **_pseudo_headers_strip(cand["headers"])}
        # Let curl_cffi manage Content-Type / Content-Length itself
        for bad in ("content-type", "content-length"):
            headers.pop(bad, None)

        print(f"\n[{i}/{len(posts)}] POST {url}")
        if payload:
            print(f"   payload: {payload[:250]}")

        try:
            r = session.post(url, headers=headers, data=payload, timeout=30)
            print(f"   → HTTP {r.status_code}")
        except Exception as e:
            print(f"   ❌ Replay error: {e}")
            continue

        if r.status_code == 403:
            print("   ⚠️ Cloudflare 403 — cookie likely expired.")
            continue
        if r.status_code >= 400:
            print(f"   ⚠️ Body: {r.text[:200]}")
            continue

        # Try to parse JSON and recursively find a .flac URL
        flac_url = None
        try:
            data = r.json()
            flac_url = _find_flac_url_in_json(data)
            if flac_url:
                print(f"   ✅ FLAC URL in JSON: {flac_url}")
        except ValueError:
            print(f"   ⚠️ Non-JSON body: {r.text[:200]}")

        if flac_url:
            if verify_remote_flac(flac_url, saved["cookies"]):
                cfg.setdefault("verified_urls", {})[vid] = {
                    "url": flac_url, "ts": int(time.time()),
                }
                save_config(cfg)
                return flac_url
            print("   ⚠️ URL captured but verification failed.")

    # ---- Also try each captured .flac URL directly (may still be valid) ----
    if saved.get("flac_urls"):
        print(f"\n🔄 Trying {len(saved['flac_urls'])} saved .flac URL(s) directly...")
        for u in saved["flac_urls"]:
            clean = u.split("?")[0] if u.count(".flac") > 1 else u
            print(f"   → {clean}")
            if verify_remote_flac(clean, saved["cookies"]):
                return clean

    print("\n❌ Direct replay could not obtain a verified FLAC URL.")
    print("   → Cloudflare may require a fresh browser session; re-run `discover`.")
    return None


# ============================================================
# 4. YT-DLP FALLBACK
# ============================================================
def ytdlp_download(target: str, out_dir: str = ".") -> str | None:
    if not HAS_YTDLP:
        print("❌ yt-dlp missing. Run: pip install yt-dlp")
        return None

    ffmpeg_dir = find_ffmpeg(auto_download=True)
    if not ffmpeg_dir:
        print("❌ Could not obtain ffmpeg/ffprobe.")
        print("   Manual: https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip")
        return None

    print(f"🎬 ffmpeg dir: {ffmpeg_dir}")

    yt_url = build_yt_url(get_video_id(target))
    print(f"🚀 [yt-dlp] {yt_url}")

    opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(out_dir, "%(title).180B [%(id)s].%(ext)s"),
        "ffmpeg_location": ffmpeg_dir,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "flac",
            "preferredquality": "0",
        }],
        "quiet": True,
        "no_warnings": True,
    }

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(yt_url, download=True)
            base, _ = os.path.splitext(ydl.prepare_filename(info))
            flac_path = base + ".flac"
            print(f"✅ Saved: {flac_path}")
            print("\n🔎 Verifying downloaded file...")
            verify_local_flac(flac_path)
            return flac_path
    except Exception as e:
        print(f"❌ yt-dlp failed: {e}")
        return None


# ============================================================
# 5. CLI
# ============================================================
def main():
    p = argparse.ArgumentParser(description="CutYT → FLAC diagnostic toolkit")
    p.add_argument("mode", choices=["discover", "direct", "ytdlp", "verify", "auto"])
    p.add_argument("target", help="YouTube URL/ID, or a FLAC file/URL for `verify`")
    p.add_argument("--out", default=".", help="Output dir for yt-dlp (default: .)")
    p.add_argument("--strict", action="store_true",
                   help="auto mode: fail if direct fails (no yt-dlp fallback)")
    args = p.parse_args()

    if args.mode == "discover":
        discover(args.target)
    elif args.mode == "direct":
        r = direct(args.target)
        sys.exit(0 if r else 1)
    elif args.mode == "ytdlp":
        r = ytdlp_download(args.target, args.out)
        sys.exit(0 if r else 1)
    elif args.mode == "verify":
        ok = verify_remote_flac(args.target) if args.target.startswith("http") \
             else verify_local_flac(args.target)
        sys.exit(0 if ok else 1)
    elif args.mode == "auto":
        r = direct(args.target)
        if not r:
            if args.strict:
                print("\n❌ auto --strict: direct() failed, not falling back.")
                sys.exit(1)
            print("\n⬇️  direct() gave nothing — switching to yt-dlp fallback.\n")
            r = ytdlp_download(args.target, args.out)
        sys.exit(0 if r else 1)


if __name__ == "__main__":
    main()