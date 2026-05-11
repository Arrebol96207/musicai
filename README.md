# Claudio Music

Claudio Music is a local-first web app for music recommendation and playback. It plays real audio from online music APIs or user-owned local files. It does not generate synthetic audio and does not use radio streams unless you explicitly ask for radio.

## Features

- Play real music from Audius full-track streams.
- Fall back to Deezer and Apple iTunes previews.
- Scan user-owned local audio files from `music/`.
- Configure DeepSeek API directly in the frontend.
- Use DeepSeek cheaply as a JSON intent parser for play/recommend/chat routing.
- Personalize recommendations with local favorites, recent plays, and style preferences.
- Persist theme, volume, favorites, history, and preferences in `user/profile.json`.
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

## Local Profile

The app stores personal data locally in `user/profile.json`. This file is ignored by Git.

It contains:

- Favorites
- Recent play history
- Preferred artists, genres, scenes, and avoided styles
- Theme and volume settings

## Start

Double-click:

```text
ClaudioMusic.exe
```

Or run with npm:

```powershell
npm start
```

Or run Node directly:

```powershell
node server.js
```

Then open the URL printed by the server, usually:

```text
http://127.0.0.1:3000/
```

If the port is occupied, the server automatically tries the next port.

## Validate

Run syntax checks:

```powershell
npm run check
```

Run smoke checks:

```powershell
npm run smoke
```

Run real HTTP smoke checks:

```powershell
npm run smoke:http
```

Run all validation:

```powershell
npm test
```

`npm run verify` is an alias of `npm test`.

## Rebuild Launcher

The Windows launcher source is in `launcher/`. The checked-in `ClaudioMusic.exe`
is only updated when you rebuild it.

Install the .NET 8 SDK, then run:

```powershell
.\scripts\build-launcher.ps1
```

The script builds `launcher/ClaudioMusicLauncher.csproj` and copies the new
`ClaudioMusic.exe` to the project root.

## Try

```text
推荐几首适合现在的歌
推荐几首适合专注写代码的歌
根据我的收藏和最近播放推荐几首歌
播放 Billie Eilish
播放 lofi chill
来点华语流行
换个心情，放松一点
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | 播放 / 暂停 |
| `←` / `→` | 上一首 / 下一首 |
| `↑` / `↓` | 音量 + / - |
| `F` | 收藏 / 取消收藏 |
| `S` | 停止播放 |
| `?` | 显示快捷键面板 |
| `Esc` | 关闭面板 |

Press `?` anytime in the app to see the full list.

## Playback Modes

- **Shuffle**: Click the shuffle icon in the queue header to randomize play order.
- **Repeat**: Click the repeat icon to cycle through 顺序 → 列表循环 → 单曲循环.
- **Sleep Timer**: Click the clock icon next to the volume slider to set a timer that pauses playback automatically.

## Queue Management

- Click any queue item to jump to that song.
- Hover and click **×** to remove a track from the queue.
- Click the trash icon to clear all non-current tracks.

## FAQ

**Q: 没有声音 / 播放失败？**
A: 检查 Audius/Deezer/iTunes 服务是否可访问；尝试换成具体歌名或歌手；把你的音乐文件放入 `music/` 文件夹。

**Q: DeepSeek API 费用如何？**
A: 本项目使用 `deepseek-v4-flash` 廉价模型，仅做意图解析（约 260 max_tokens），单次请求约 0.0001 元。

**Q: 端口被占用？**
A: 服务器会自动尝试 3000-3010 端口，查看终端输出确认实际端口。

## API

### Endpoints

- `GET /api/health` - 服务健康状态
- `GET /api/ai/status` - DeepSeek 配置状态
- `POST /api/ai/config` - 配置 DeepSeek
- `POST /api/ai/clear` - 清除 DeepSeek 配置
- `GET /api/user/profile` - 用户资料
- `POST /api/user/favorite` - 收藏/取消收藏
- `POST /api/user/history` - 添加播放历史
- `POST /api/user/preferences` - 更新偏好
- `POST /api/user/settings` - 更新设置
- `GET /api/now` - 当前播放状态
- `GET /api/next` - 下一首
- `GET /api/previous` - 上一首
- `POST /api/play` - 播放/暂停控制
- `GET /api/music/search?q=lofi` - 搜索音乐
- `POST /api/music/play` - 播放指定歌曲
- `POST /api/music/recommend` - 推荐音乐
- `POST /api/chat` - 聊天式点歌
- `POST /api/queue/shuffle` - 随机播放
- `POST /api/queue/remove` - 移除队列项
- `POST /api/queue/clear` - 清空队列
- `GET /api/stream` - 获取可播放流

### Request Parameters

| Endpoint | Field | Type | Required | Range / Default | Description |
|---|---|---|---|---|---|
| `POST /api/play` | `index` | integer | no | `0..queue.length-1` | 跳转到指定队列项 |
| `POST /api/play` | `playing` | boolean | no | unchanged | 设置播放或暂停 |
| `POST /api/play` | `volume` | number | no | `0..1` | 保存播放器音量 |
| `POST /api/play` | `track` | object | no | sanitized | 添加并播放已保存曲目 |
| `GET /api/music/search` | `q` | string | no | max 200 chars | 搜索关键词，缺省时使用推荐语义 |
| `POST /api/music/play` | `query` / `keyword` | string | yes | 1..200 chars | 要播放的歌曲、歌手或风格 |
| `POST /api/music/recommend` | `message` / `mood` | string | no | max 200 chars, default `recommend music` | 推荐描述 |
| `POST /api/chat` | `message` | string | yes | 1..200 chars | 聊天式点歌或控制内容 |
| `POST /api/queue/shuffle` | `shuffle` | boolean | no | default `false` | 开启或关闭随机播放 |
| `POST /api/queue/remove` | `trackId` | string | no | max 160 chars | 优先使用的稳定歌曲 ID |
| `POST /api/queue/remove` | `index` | integer | no | `0..dynamicQueue.length-1` | 未提供 `trackId` 时按动态队列索引移除 |
| `POST /api/ai/config` | `apiKey` | string | yes | max 300 chars | DeepSeek API Key，不会在响应中回显 |
| `POST /api/ai/config` | `model` | string | no | max 80 chars | DeepSeek 模型名称 |
| `POST /api/ai/config` | `apiBase` | HTTPS URL | no | default `https://api.deepseek.com` | DeepSeek API 基础地址，必须使用 HTTPS |

Validation errors return `code: "VALIDATION_ERROR"` and may include a `fields` object with field-specific guidance.

### Request Examples

```powershell
# 搜索音乐
curl "http://127.0.0.1:3000/api/music/search?q=lofi"

# 推荐音乐
curl -X POST http://127.0.0.1:3000/api/music/recommend -H "Content-Type: application/json" -d '{"message":"推荐几首适合放松的歌"}'

# 播放指定歌曲
curl -X POST http://127.0.0.1:3000/api/music/play -H "Content-Type: application/json" -d '{"query":"Billie Eilish"}'

# 随机播放
curl -X POST http://127.0.0.1:3000/api/queue/shuffle -H "Content-Type: application/json" -d '{"shuffle":true}'

# 移除队列项 (按索引或 trackId)
curl -X POST http://127.0.0.1:3000/api/queue/remove -H "Content-Type: application/json" -d '{"index":2}'
curl -X POST http://127.0.0.1:3000/api/queue/remove -H "Content-Type: application/json" -d '{"trackId":"audius:123"}'
```

### Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `VALIDATION_ERROR` | 400 | 请求参数无效，响应可能包含 `fields` 字段说明具体问题 |
| `QUERY_REQUIRED` | 400 | 缺少搜索关键词 |
| `INVALID_INDEX` | 400 | 无效的队列索引 |
| `INDEX_OUT_OF_RANGE` | 400 | 队列索引超出范围 |
| `TRACK_NOT_FOUND` | 400 | 动态队列中未找到指定歌曲 |
| `INVALID_JSON` | 400 | 请求体不是有效 JSON |
| `BODY_TOO_LARGE` | 413 | 请求体超过 1MB 限制 |
| `ROUTE_NOT_FOUND` | 404 | API 路由不存在 |
| `DEEPSEEK_KEY_REQUIRED` | 500 | DeepSeek API Key 未配置 |
| `NO_PLAYABLE_MUSIC` | 502 | 所有音乐源均无可用结果 |
| `UPSTREAM_TIMEOUT` | 502 | 上游音乐源请求超时 |
| `UPSTREAM_EMPTY` | 502 | 上游音乐源返回空结果 |
| `SERVER_ERROR` | 500 | 服务器内部错误 |

## Environment Variables

```powershell
# DeepSeek 配置
$env:DEEPSEEK_API_KEY="your DeepSeek key"
$env:DEEPSEEK_MODEL="deepseek-v4-flash"
$env:DEEPSEEK_API_BASE="https://api.deepseek.com"
$env:DEEPSEEK_TIMEOUT_MS="10000"
$env:DEEPSEEK_MAX_TOKENS="260"

# 服务端口 (默认 3000)
$env:PORT="3000"

# 调试模式 (显示详细错误信息)
$env:CLAUDIO_DEBUG_ERRORS="1"

# 性能日志 (显示慢调用)
$env:CLAUDIO_PERF="1"
```

## Check

```powershell
node --check server.js
node --check public\app.js
node scripts\smoke.js
```
