const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const versionToken = "__CLAUDIO_FRONTEND_VERSION__";
const required = [
  "server.js",
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "public/manifest.webmanifest",
  "public/service-worker.js",
  "launcher/ClaudioMusicLauncher.cs",
  "launcher/ClaudioMusicLauncher.csproj",
  "scripts/build-launcher.ps1",
  "scripts/start-launcher.ps1",
  "scripts/smoke-http.js",
  "一键启动.bat",
  "data/tracks.json",
  "README.md",
  ".gitignore"
];

const missing = required.filter(file => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Missing files: ${missing.join(", ")}`);
  process.exit(1);
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function parseJson(file) {
  return JSON.parse(read(file));
}

const html = read("public/index.html");
const app = read("public/app.js");
const server = read("server.js");
const serviceWorker = read("public/service-worker.js");
const launcher = read("launcher/ClaudioMusicLauncher.cs");
const launcherProject = read("launcher/ClaudioMusicLauncher.csproj");
const launcherBuild = read("scripts/build-launcher.ps1");
const startLauncher = read("scripts/start-launcher.ps1");
const oneClickLauncher = read("一键启动.bat");
const styles = read("public/styles.css");
const gitignore = read(".gitignore");
const readme = read("README.md");
const manifest = parseJson("public/manifest.webmanifest");
const tracks = parseJson("data/tracks.json");

const textFiles = {
  "public/index.html": html,
  "public/app.js": app,
  "server.js": server,
  "launcher/ClaudioMusicLauncher.cs": launcher,
  "README.md": readme
};

const forbiddenClientAudio = [
  "AudioContext",
  "OscillatorNode",
  "createOscillator",
  "synth",
  "alert("
];

const mojibakePattern = /(?:鎾|鎺|鐚|鍠|鏈|惰棌|鍛婅瘔|娴忚|閫|鈾|�)/;
const failed = [];

function check(name, ok) {
  if (!ok) failed.push(name);
}

Object.entries(textFiles).forEach(([file, content]) => {
  check(`${file} has no replacement characters`, !content.includes("\uFFFD"));
  check(`${file} has no common mojibake`, !mojibakePattern.test(content));
});

check("HTML uses dynamic app cache-busting token", html.includes(`/app.js?v=${versionToken}`));
check("HTML uses dynamic CSS cache-busting token", html.includes(`/styles.css?v=${versionToken}`));
check("Service worker cache uses dynamic version token", serviceWorker.includes(`claudio-music-${versionToken}`));
check("Service worker caches dynamic versioned assets", serviceWorker.includes(`/app.js?v=${versionToken}`) && serviceWorker.includes(`/styles.css?v=${versionToken}`));
check("Server app version is automatic", server.includes("const APP_VERSION = process.env.CLAUDIO_APP_VERSION || fileVersion(__filename)"));
check("Server frontend version is automatic", server.includes("const FRONTEND_VERSION = process.env.CLAUDIO_FRONTEND_VERSION || [") && server.includes("renderVersionedAsset"));
check("README start URL does not pin a stale version", readme.includes("http://127.0.0.1:3000/") && !/\?v=\d+/.test(readme));
check("Launcher uses unpinned start URL", !launcher.includes("private const string AppVersion") && !launcher.includes("VersionQuery"));
check("Launcher accepts any healthy Claudio version", launcher.includes("IsClaudioHealth") && !launcher.includes("HasCurrentAppVersion"));
check("Launcher has no stale v9 checks", !launcher.includes("v=9") && !launcher.includes('"appVersion":"9"'));
check("Launcher project targets Windows .NET", launcherProject.includes("<TargetFramework>net8.0-windows</TargetFramework>") && launcherProject.includes("<AssemblyName>ClaudioMusic</AssemblyName>"));
check("Launcher build script copies root exe", launcherBuild.includes("dotnet build") && launcherBuild.includes("Copy-Item") && launcherBuild.includes("ClaudioMusic.exe"));
check("One-click launcher delegates to PowerShell script", oneClickLauncher.includes("scripts\\start-launcher.ps1") && oneClickLauncher.includes("ExecutionPolicy Bypass"));
check("PowerShell launcher starts backend and opens browser", startLauncher.includes("Start-Process -FilePath $node") && startLauncher.includes("Start-Process $url") && startLauncher.includes("Find-ClaudioPort"));
check("PowerShell launcher reuses existing backend", startLauncher.includes("$existingPort = Find-ClaudioPort") && startLauncher.includes("Claudio Music is already running"));

check("HTML Chinese text is readable", html.includes("播放列表") && html.includes("猜你喜欢") && html.includes("我的收藏"));
check("HTML includes top status strip", html.includes("status-strip") && html.includes("serviceStatus") && html.includes("networkStatus") && html.includes("cacheStatus") && html.includes("installBtn"));
check("Client Chinese text is readable", app.includes("告诉 Claudio 你想听什么") && app.includes("这首歌没有可播放地址"));
check("README Chinese examples are readable", readme.includes("推荐几首适合现在的歌") && readme.includes("播放 Billie Eilish"));
check("README documents launcher rebuild", readme.includes("Rebuild Launcher") && readme.includes("build-launcher.ps1"));
check("Manifest names the app", manifest.name === "Claudio Music" || manifest.short_name === "Claudio");

check("Client uses a real audio element", app.includes("new Audio()"));
check("Client has no synthetic audio or alert fallback", forbiddenClientAudio.every(token => !app.includes(token)));
check("Client calls recommendation endpoint", app.includes("/api/music/recommend"));
check("Client restores busy state after recommendation", app.includes("async function recommend") && app.includes("finally") && app.includes("setBusy(false)"));
check("Client handles network fetch failure", app.includes("网络连接不稳定，请稍后再试。"));
check("Client tracks PWA install prompt", app.includes("beforeinstallprompt") && app.includes("deferredInstallPrompt") && app.includes("appinstalled"));
check("Client tracks online and offline status", app.includes('window.addEventListener("online"') && app.includes('window.addEventListener("offline"') && app.includes("navigator.onLine"));
check("Client reports service worker cache state", app.includes("swRegistration") && app.includes("缓存就绪") && app.includes("刷新可更新"));
check("Client supports favorites", app.includes("/api/user/favorite") && html.includes("我的收藏"));
check("Client supports recent plays", app.includes("/api/user/history") && html.includes("最近播放"));
check("Client supports preferences", app.includes("/api/user/preferences") && html.includes("喜欢的歌手"));
check("Client supports persisted settings", app.includes("/api/user/settings"));
check("Client has DeepSeek settings form", html.includes("DeepSeek 设置") && app.includes("/api/ai/config"));
check("Styles include memory and quick panels", styles.includes(".memory-settings") && styles.includes(".quick-panel"));
check("Styles include top status strip", styles.includes(".status-strip") && styles.includes(".status-chip") && styles.includes(".install-button"));

check("Server exposes health endpoint", server.includes("/api/health"));
check("Health exposes non-sensitive sources", server.includes("sources: musicSourcesState()") && server.includes("localFiles") && server.includes("checks"));
check("Health does not expose DeepSeek secret", !/apiKey\s*:\s*deepSeekConfig\.apiKey/.test(server));
check("Server exposes user profile endpoint", server.includes("/api/user/profile"));
check("Server exposes favorite endpoint", server.includes("/api/user/favorite"));
check("Server exposes history endpoint", server.includes("/api/user/history"));
check("Server exposes preferences endpoint", server.includes("/api/user/preferences"));
check("Server exposes settings endpoint", server.includes("/api/user/settings"));
check("Server exposes AI status endpoint", server.includes("/api/ai/status"));
check("Server exposes AI config endpoint", server.includes("/api/ai/config"));
check("Server exposes music play endpoint", server.includes("/api/music/play"));
check("Server exposes unified error payload", server.includes("function errorPayload") && server.includes("ok: false") && server.includes("code: error?.code"));
check("Server uses friendly no-playable error", server.includes("NO_PLAYABLE_MUSIC") && server.includes("没有找到可播放的真实音乐"));
check("Server has unified parameter helpers", server.includes("function asString") && server.includes("function asNumber") && server.includes("function asBoolean"));
check("Server has strict validation helpers", server.includes("function requireString") && server.includes("function optionalNumber") && server.includes("function validationError"));
check("Server exposes validation fields safely", server.includes("payload.fields = error.details.fields") && server.includes("VALIDATION_ERROR"));
check("Server validates DeepSeek apiBase as HTTPS URL", server.includes("function normalizeHttpsBase") && server.includes("parsed.protocol !== \"https:\""));
check("Server validates playback parameters", server.includes("optionalNumber(body.index, \"index\"") && server.includes("optionalBoolean(body.playing, \"playing\"") && server.includes("optionalNumber(body.volume, \"volume\""));
check("Server validates chat messages", server.includes("requireString(body.message, \"message\"") && server.includes("maxLength: 200"));
check("Server supports queue remove by trackId", server.includes("optionalString(body.trackId, \"trackId\"") && server.includes("TRACK_NOT_FOUND"));
check("Server uses path.resolve for public path", server.includes("path.resolve(filePath)") && server.includes("function isPathInsideRoot"));
check("Server handles invalid URL encoding safely", server.includes("function safeDecodeURIComponent") && server.includes("INVALID_URL_ENCODING"));
check("Server compares path roots case-insensitively on Windows", server.includes('process.platform === "win32"') && server.includes("toLowerCase()") && server.includes("isPathInsideRoot(resolved, publicRoot)"));
check("Server correlates logs and JSON with requestId", server.includes("crypto.randomUUID().slice(0, 8)") && server.includes("res.requestId") && server.includes("logRequest(requestId"));
check("Package exposes real HTTP smoke test", read("package.json").includes('"smoke:http": "node scripts/smoke-http.js"'));

check("Client has validation field support", app.includes("error.fields = payload.fields") && app.includes("function validationSummary"));
check("Client optimizes unchanged queue renders", app.includes("els.queueList.dataset.signature") && app.includes("return;"));
check("Client updates sleep timer expanded state", app.includes("aria-expanded") && app.includes("els.sleepBtn.setAttribute"));
check("CSS keeps queue remove visible on small screens", styles.includes(".queue-item .remove-btn") && styles.includes("grid-column: 3"));
check("CSS has keyboard focus visibility", styles.includes(":focus-visible") && styles.includes(".queue-item:focus-visible"));
check("CSS supports multiline toast errors", styles.includes("white-space: pre-line") && styles.includes("overflow-wrap: anywhere"));

check("Client has tryRefresh render call", app.includes("const data = await api(\"/api/now\")") && app.includes("render(data)"));
check("Client has MediaMetadata safety check", app.includes("typeof MediaMetadata !== \"undefined\""));
check("Client has retry by status code", app.includes("[502, 503, 504].includes(error.status)") && app.includes("error.code === \"UPSTREAM_TIMEOUT\""));
check("Client has phased loading feedback", app.includes("setLoadingPhase") && app.includes("正在解析意图"));
check("Client hides remove button for local tracks", app.includes("const canRemove = track.source !== \"local\""));
check("Client has audio failure recovery", app.includes("function handlePlaybackFailure") && app.includes("await nextTrack(true)"));
check("Client supports queue clear undo toast action", app.includes("function restoreClearedQueue") && app.includes("toast-action"));
check("Client limits long queue renders", app.includes("QUEUE_RENDER_LIMIT") && app.includes("visibleQueue = queue.slice"));
check("Server supports audio range streaming", server.includes("function serveAudioFile") && server.includes("Content-Range") && server.includes("Accept-Ranges"));
check("Server exposes lightweight now state", server.includes("function publicNowState") && server.includes("/api/now-lite"));
check("Server broadcasts state to SSE clients", server.includes("const sseClients = new Set()") && server.includes("function broadcastState") && server.includes("ensureSseHeartbeat"));
check("Server caches music search results", server.includes("const searchCache = new Map()") && server.includes("SEARCH_CACHE_TTL_MS") && server.includes("setSearchCache(cacheKey"));
check("Server limits recommendation concurrency", server.includes("RECOMMENDATION_CONCURRENCY") && server.includes("runLimited(queries"));
check("Server protects AI admin endpoints", server.includes("function requireAdmin") && server.includes("CLAUDIO_ADMIN_TOKEN") && server.includes("x-claudio-token"));

check("Server uses Audius", server.includes("api.audius.co/v1"));
check("Server uses Deezer", server.includes("api.deezer.com"));
check("Client labels Deezer preview", app.includes("DEEZER PREVIEW"));
check("Server uses iTunes preview", server.includes("itunes.apple.com"));
check("Server connects DeepSeek", server.includes("api.deepseek.com"));
check("Server uses cheap DeepSeek model default", server.includes("deepseek-v4-flash"));
check("Server disables DeepSeek thinking", server.includes('thinking: { type: "disabled" }'));
check("Server uses user profile in recommendations", server.includes("profileSummary") && server.includes("preferenceQueries"));
check("Radio is explicit fallback only", server.includes("wantsRadio") && server.includes("explicit-radio-only"));
check("User profile is ignored by git", gitignore.includes("user/profile.json"));
check("Local music files are ignored by git", gitignore.includes("music/*") && gitignore.includes("!music/README.md"));
check("Track library is JSON array", Array.isArray(tracks));

if (failed.length) {
  console.error(`Failed checks:\n- ${failed.join("\n- ")}`);
  process.exit(1);
}

console.log("Smoke checks passed.");
