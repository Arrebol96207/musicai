# Claudio Music

Claudio Music 是一个本地优先的音乐推荐与播放 Web 应用。它会播放来自在线音乐 API 或用户自有本地文件的真实音频，不生成合成音频，也不会使用电台流，除非你明确要求播放电台。

## 功能

- 从 Audius 完整曲目流播放真实音乐。
- 在需要时回退到 Deezer 和 Apple iTunes 试听片段。
- 自动扫描 `music/` 中用户自有的本地音频文件。
- 可以直接在前端配置 DeepSeek API。
- 使用低成本 DeepSeek 模型作为 JSON 意图解析器，用于播放、推荐和聊天路由。
- 根据本地收藏、最近播放和风格偏好个性化推荐。
- 将主题、音量、收藏、历史和偏好保存在 `user/profile.json`。
- 支持队列筛选、复制当前歌曲、复制当前筛选队列和清空队列撤销。
- 支持在界面中刷新曲库，立即重新扫描 `music/` 和 `data/tracks.json`。
- 支持 SSE 实时同步、前台恢复重同步、请求超时提示和最多 3 条 toast 反馈。
- 支持 PWA 安装、离线外壳缓存和安装后的快捷入口。
- 提供一键 Windows 启动器：`ClaudioMusic.exe`。

## 音乐来源

- Audius：主要的完整曲目来源。
- Deezer Search API：试听片段回退来源。
- Apple iTunes Search API：试听片段回退来源。
- 本地文件：把你自己的 `.mp3`、`.wav`、`.ogg`、`.m4a`、`.aac` 或 `.flac` 文件放入 `music/`。
- Radio Browser：仅在用户明确要求播放电台时使用。

## DeepSeek

可以直接在应用界面中配置 DeepSeek。

默认配置：

```text
Model: deepseek-v4-flash
Base URL: https://api.deepseek.com
```

也可以通过环境变量配置：

```powershell
$env:DEEPSEEK_API_KEY="your DeepSeek key"
node server.js
```

或者创建 `.env`：

```text
DEEPSEEK_API_KEY=your DeepSeek key
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_API_BASE=https://api.deepseek.com
```

未配置 API Key 时，应用会自动回退到本地规则。

## 本地资料

应用会把个人数据保存在本地的 `user/profile.json`，该文件已被 Git 忽略。

其中包含：

- 收藏
- 最近播放历史
- 偏好的艺人、流派、场景和想避开的风格
- 主题、音量和循环模式设置

侧边栏的“导出资料”会下载一份 JSON 备份，“导入资料”可以恢复这份备份。导入时后端会按当前资料模型重新校验和裁剪字段，并自动保存导入前资料。侧边栏的“最近备份”会列出最近 5 份导入前备份，toast 撤销消失后也可以点选恢复。

## 启动

双击：

```text
一键启动.bat
```

这个脚本会检查 Node.js，在需要时安装依赖，启动服务器，检测实际端口，并自动打开浏览器。

`一键启动.bat` checks Node.js, installs dependencies when needed, starts the server, detects the real port, and opens the browser automatically.

如果已经重新构建 Windows 启动器，也可以双击：

```text
ClaudioMusic.exe
```

或者使用 npm 运行：

```powershell
npm start
```

也可以直接运行 Node：

```powershell
node server.js
```

然后打开服务器打印的 URL，通常是：

```text
http://127.0.0.1:3000/
```

如果端口被占用，服务器会自动尝试下一个端口。

## 验证

运行语法检查：

```powershell
npm run check
```

运行冒烟检查：

```powershell
npm run smoke
```

运行真实 HTTP 冒烟检查：

```powershell
npm run smoke:http
```

运行 HTTP helper 行为检查：

```powershell
npm run smoke:http-helpers
```

运行真实浏览器 UI 截图检查：

```powershell
npm run smoke:ui
```

运行快速验证（不启动浏览器）：

```powershell
npm test
```

运行完整验证（包含真实 UI 截图）：

```powershell
npm run verify
```

## 安装为应用

在支持 PWA 的浏览器中，顶部状态栏会出现 **安装应用**。安装后 Claudio 会以独立窗口运行，并提供“推荐音乐”和“播放队列”快捷入口。离线时仍会显示缓存的应用外壳，并提示恢复网络。

## 重新构建启动器 (Rebuild Launcher)

Windows 启动器源码位于 `launcher/`。仓库中的 `ClaudioMusic.exe` 只会在重新构建后更新。

安装 .NET 8 SDK 后运行：

```powershell
.\scripts\build-launcher.ps1
```

脚本会构建 `launcher/ClaudioMusicLauncher.csproj`，并把新的 `ClaudioMusic.exe` 复制到项目根目录。

## 试用示例

```text
推荐几首适合现在的歌
推荐几首适合专注写代码的歌
根据我的收藏和最近播放推荐几首歌
播放 Billie Eilish
播放 lofi chill
来点华语流行
换个心情，放松一点
```

## 键盘快捷键

| 按键 | 操作 |
|-----|-----|
| `Space` | 播放 / 暂停 |
| `←` / `→` | 上一首 / 下一首 |
| `↑` / `↓` | 音量 + / - |
| `F` | 收藏 / 取消收藏 |
| `/` | 聚焦播放队列筛选 |
| `C` | 复制当前歌曲 |
| `S` | 停止播放 |
| `?` | 显示快捷键面板 |
| `Esc` | 关闭面板 |

在应用中随时按 `?` 可以查看完整列表。

## 播放模式

- **随机播放**：点击队列标题中的随机图标，打乱播放顺序。
- **循环模式**：点击循环图标，在 顺序 → 列表循环 → 单曲循环 之间切换。
- **睡眠定时**：点击音量滑块旁的时钟图标，设置自动暂停播放的定时器。

## 队列管理

- 在队列搜索框中输入歌名、歌手、来源或风格，可即时筛选当前队列。
- 点击任意队列项可跳转到对应歌曲。
- 悬停并点击 **×** 可从队列中移除歌曲。
- 点击复制图标可复制当前队列；如果正在筛选，则只复制筛选结果。
- 点击垃圾桶图标可清除当前歌曲以外的队列项。
- 清空队列后可以通过 toast 中的 **撤销** 按钮恢复。
- 把新音频放入 `music/` 后，点击 **刷新曲库** 可立即重新扫描，不必等待缓存过期或重启服务。

## 常见问题

**Q: 没有声音 / 播放失败？**
A: 检查 Audius/Deezer/iTunes 服务是否可访问；尝试换成具体歌名或歌手；把你的音乐文件放入 `music/` 文件夹。

**Q: DeepSeek API 费用如何？**
A: 本项目使用 `deepseek-v4-flash` 廉价模型，仅做意图解析（约 260 max_tokens），单次请求约 0.0001 元。

**Q: 端口被占用？**
A: 服务器会自动尝试 3000-3010 端口，查看终端输出确认实际端口。

## API

### 接口

- `GET /api/health` - 服务健康状态
- `GET /api/ai/status` - DeepSeek 配置状态
- `POST /api/ai/config` - 配置 DeepSeek
- `POST /api/ai/clear` - 清除 DeepSeek 配置
- `GET /api/user/profile` - 用户资料
- `POST /api/user/profile` - 导入用户资料备份
- `GET /api/user/profile/backups` - 最近导入前备份列表
- `POST /api/user/profile/restore` - 恢复指定导入前备份
- `POST /api/user/favorite` - 收藏/取消收藏
- `POST /api/user/history` - 添加播放历史
- `POST /api/user/preferences` - 更新偏好
- `POST /api/user/settings` - 更新设置
- `GET /api/now` - 当前播放状态
- `POST /api/next` - 下一首
- `POST /api/previous` - 上一首
- `POST /api/play` - 播放/暂停控制
- `GET /api/music/search?q=lofi` - 搜索音乐
- `POST /api/music/play` - 播放指定歌曲
- `POST /api/music/recommend` - 推荐音乐
- `POST /api/chat` - 聊天式点歌
- `POST /api/queue/shuffle` - 随机播放
- `POST /api/queue/remove` - 移除队列项
- `POST /api/queue/clear` - 清空队列
- `POST /api/library/refresh` - 重新扫描本地曲库
- `GET /api/stream` - 获取可播放流

### 请求参数

| 接口 | 字段 | 类型 | 必填 | 范围 / 默认值 | 说明 |
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

校验错误会返回 `code: "VALIDATION_ERROR"`，并可能包含 `fields` 对象说明具体字段问题。

### 请求示例

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

### 错误码

| 错误码 | 状态码 | 说明 |
|------|--------|-----|
| `VALIDATION_ERROR` | 400 | 请求参数无效，响应可能包含 `fields` 字段说明具体问题 |
| `QUERY_REQUIRED` | 400 | 缺少搜索关键词 |
| `INVALID_INDEX` | 400 | 无效的队列索引 |
| `INDEX_OUT_OF_RANGE` | 400 | 队列索引超出范围 |
| `TRACK_NOT_FOUND` | 400 | 动态队列中未找到指定歌曲 |
| `INVALID_JSON` | 400 | 请求体不是有效 JSON |
| `BODY_TOO_LARGE` | 413 | 请求体超过 1MB 限制 |
| `ROUTE_NOT_FOUND` | 404 | API 路由不存在 |
| `DEEPSEEK_KEY_REQUIRED` | 500 | DeepSeek API Key 未配置 |
| `ADMIN_TOKEN_REQUIRED` | 500 | 已开启管理员授权，但未配置 `CLAUDIO_ADMIN_TOKEN` |
| `NO_PLAYABLE_MUSIC` | 502 | 所有音乐源均无可用结果 |
| `UPSTREAM_TIMEOUT` | 504 | 上游音乐源请求超时 |
| `UPSTREAM_EMPTY` | 502 | 上游音乐源返回空结果 |
| `SERVER_ERROR` | 500 | 服务器内部错误 |

## 环境变量

```powershell
# DeepSeek 配置
$env:DEEPSEEK_API_KEY="your DeepSeek key"
$env:DEEPSEEK_MODEL="deepseek-v4-flash"
$env:DEEPSEEK_API_BASE="https://api.deepseek.com"
$env:DEEPSEEK_TIMEOUT_MS="10000"
$env:DEEPSEEK_MAX_TOKENS="260"

# 服务端口 (默认 3000)
$env:PORT="3000"

# 本地默认不需要管理员 token；只有暴露到远程或多人环境时才建议开启
$env:CLAUDIO_REQUIRE_ADMIN_TOKEN="1"
$env:CLAUDIO_ADMIN_TOKEN="your-local-admin-token"

# 调试模式 (显示详细错误信息)
$env:CLAUDIO_DEBUG_ERRORS="1"

# 性能日志 (显示慢调用)
$env:CLAUDIO_PERF="1"
```

## 检查

```powershell
npm run check
npm test
npm run verify
```
