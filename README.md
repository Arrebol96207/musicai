# Claudio Music

Claudio Music is a local web app for music recommendation and playback. It does not generate synthetic audio and does not use radio streams unless you explicitly ask for radio.

## Features

- Play real music from Audius full-track streams.
- Fall back to Deezer and Apple iTunes previews.
- Scan user-owned local audio files from `music/`.
- Configure DeepSeek API directly in the frontend.
- Use DeepSeek cheaply as a JSON intent parser for play/recommend/chat routing.
- One-click Windows launcher: `ClaudioMusic.exe`.

## Music Sources

- Audius: primary full-track source.
- Deezer Search API: preview fallback.
- Apple iTunes Search API: preview fallback.
- Local files: put your own `.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, or `.flac` files in `music/`.
- Radio Browser: only used when the user explicitly requests radio.

## DeepSeek

You can configure DeepSeek directly in the app UI.

Defaults:

```text
Model: deepseek-v4-flash
Base URL: https://api.deepseek.com
```

You can also configure it with environment variables:

```powershell
$env:DEEPSEEK_API_KEY="your DeepSeek key"
node server.js
```

Or create `.env`:

```text
DEEPSEEK_API_KEY=your DeepSeek key
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_API_BASE=https://api.deepseek.com
```

Without a key, the app automatically falls back to local rules.

## Start

Double-click:

```text
ClaudioMusic.exe
```

Or run manually:

```powershell
node server.js
```

Then open the URL printed by the server, usually:

```text
http://127.0.0.1:3000/?v=9
```

If the port is occupied, the server automatically tries the next port.

## Try

```text
推荐几首适合现在的歌
推荐几首适合专注写代码的歌
播放 Billie Eilish
播放 lofi chill
来点华语流行
换个心情，放松一点
```

## API

- `GET /api/health`
- `GET /api/ai/status`
- `POST /api/ai/config`
- `POST /api/ai/clear`
- `GET /api/now`
- `GET /api/next`
- `GET /api/previous`
- `POST /api/play`
- `GET /api/music/search?q=lofi`
- `POST /api/music/play`
- `POST /api/music/recommend`
- `POST /api/chat`
- `GET /api/stream`

## Check

```powershell
node --check server.js
node --check public\app.js
node scripts\smoke.js
```
