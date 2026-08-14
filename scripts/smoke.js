const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const versionToken = "__CLAUDIO_FRONTEND_VERSION__";
const required = [
  "server.js",
  "lib/http.js",
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "public/manifest.webmanifest",
  "public/service-worker.js",
  "public/icons/icon-192.png",
  "public/icons/icon-512.png",
  "launcher/ClaudioMusicLauncher.cs",
  "launcher/ClaudioMusicLauncher.csproj",
  "scripts/build-launcher.ps1",
  "scripts/start-and-open.ps1",
  "一键启动.bat",
  "scripts/smoke-http.js",
  "scripts/smoke-http-helpers.js",
  "scripts/smoke-ui.js",
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
const httpHelpers = read("lib/http.js");
const serviceWorker = read("public/service-worker.js");
const launcher = read("launcher/ClaudioMusicLauncher.cs");
const launcherProject = read("launcher/ClaudioMusicLauncher.csproj");
const launcherBuild = read("scripts/build-launcher.ps1");
const oneClickBat = read("一键启动.bat");
const oneClickPs = read("scripts/start-and-open.ps1");
const styles = read("public/styles.css");
const gitignore = read(".gitignore");
const readme = read("README.md");
const manifest = parseJson("public/manifest.webmanifest");
const tracks = parseJson("data/tracks.json");

const textFiles = {
  "public/index.html": html,
  "public/app.js": app,
  "server.js": server,
  "lib/http.js": httpHelpers,
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
check("Service worker supports explicit update activation", serviceWorker.includes('event.data?.type === "SKIP_WAITING"') && serviceWorker.includes("self.skipWaiting()"));
check("Server app version is automatic", server.includes("const APP_VERSION = process.env.CLAUDIO_APP_VERSION || fileVersion(__filename)"));
check("Server frontend version is automatic", server.includes("const FRONTEND_VERSION = process.env.CLAUDIO_FRONTEND_VERSION || [") && server.includes("renderVersionedAsset"));
check("Server immutable-caches versioned frontend assets", server.includes("VERSIONED_STATIC_CACHE") && server.includes("max-age=31536000, immutable") && server.includes('url.searchParams.get("v") === FRONTEND_VERSION'));
check("README start URL does not pin a stale version", readme.includes("http://127.0.0.1:3000/") && !/\?v=\d+/.test(readme));
check("Launcher uses unpinned start URL", !launcher.includes("private const string AppVersion") && !launcher.includes("VersionQuery"));
check("Launcher accepts any healthy Claudio version", launcher.includes("IsClaudioHealth") && !launcher.includes("HasCurrentAppVersion"));
check("Launcher has no stale v9 checks", !launcher.includes("v=9") && !launcher.includes('"appVersion":"9"'));
check("Launcher project targets Windows .NET", launcherProject.includes("<TargetFramework>net8.0-windows</TargetFramework>") && launcherProject.includes("<AssemblyName>ClaudioMusic</AssemblyName>"));
check("Launcher build script copies root exe", launcherBuild.includes("dotnet build") && launcherBuild.includes("Copy-Item") && launcherBuild.includes("ClaudioMusic.exe"));

check("HTML Chinese text is readable", html.includes("播放列表") && html.includes("猜你喜欢") && html.includes("我的收藏"));
check("HTML includes top status strip", html.includes("status-strip") && html.includes("serviceStatus") && html.includes("networkStatus") && html.includes("cacheStatus") && html.includes("installBtn"));
check("HTML includes installable app metadata", html.includes('name="application-name"') && html.includes('apple-mobile-web-app-capable') && html.includes('rel="apple-touch-icon"'));
check("Client Chinese text is readable", app.includes("告诉 Claudio 你想听什么") && app.includes("这首歌没有可播放地址"));
check("README Chinese examples are readable", readme.includes("推荐几首适合现在的歌") && readme.includes("播放 Billie Eilish"));
check("README documents queue sharing and filtering", readme.includes("队列筛选") && readme.includes("复制当前筛选队列") && readme.includes("复制图标可复制当前队列"));
check("README documents library refresh", readme.includes("刷新曲库") && readme.includes("POST /api/library/refresh"));
check("README documents new shortcuts", readme.includes("| `/` | 聚焦播放队列筛选 |") && readme.includes("| `C` | 复制当前歌曲 |"));
check("README documents runtime polish", readme.includes("前台恢复重同步") && readme.includes("最多 3 条 toast"));
check("README documents launcher rebuild", readme.includes("Rebuild Launcher") && readme.includes("build-launcher.ps1"));
check("README documents one-click start", readme.includes("一键启动.bat") && readme.includes("opens the browser automatically"));
check("One-click batch delegates to PowerShell launcher", oneClickBat.includes("scripts\\start-and-open.ps1") && oneClickBat.includes("npm install") && oneClickBat.includes("where node"));
check("One-click PowerShell starts server and opens browser", oneClickPs.includes("Start-Process -FilePath $Node.Source") && oneClickPs.includes("server.js") && oneClickPs.includes("Start-Process $url"));
check("One-click PowerShell probes Claudio health", oneClickPs.includes("/api/health") && oneClickPs.includes("ClaudioMusic") && oneClickPs.includes("Get-ClaudioHealthUrl"));
check("One-click PowerShell reuses existing server before launching", oneClickPs.includes("$existingUrl = Get-ClaudioHealthUrl") && oneClickPs.indexOf("$existingUrl = Get-ClaudioHealthUrl") < oneClickPs.indexOf("Start-Process -FilePath $Node.Source"));
check("One-click PowerShell opens the started server port", oneClickPs.includes("Get-ClaudioReadyUrlFromLog") && oneClickPs.includes("Test-ClaudioHealthUrl $readyUrl"));
check("One-click PowerShell serializes launcher startup", oneClickPs.includes("ClaudioMusicLauncherStartup") && oneClickPs.includes("$mutex.WaitOne"));
check("Launcher reuses health endpoint only", launcher.includes("FindExistingClaudioPort") && launcher.includes("IsHealthyClaudioPort") && !launcher.includes("/api/now"));
check("Launcher opens started server port", launcher.includes("ReadyPort") && launcher.includes("ParseReadyPort") && launcher.includes("WaitForServerPort"));
check("Launcher serializes startup with shared mutex", launcher.includes("Local\\\\ClaudioMusicLauncherStartup") && launcher.includes("WaitForStartupLock"));
check("Manifest names the app", manifest.name === "Claudio Music" || manifest.short_name === "Claudio");
check("Manifest has app identity and scope", manifest.id === "/?source=pwa" && manifest.scope === "/" && manifest.lang === "zh-CN");
check("Manifest has PWA display metadata", manifest.display === "standalone" && Array.isArray(manifest.display_override) && manifest.display_override.includes("window-controls-overlay") && manifest.orientation === "any");
check("Manifest includes PNG install icons", Array.isArray(manifest.icons) && manifest.icons.some(icon => icon.src === "/icons/icon-192.png" && icon.sizes === "192x192" && icon.type === "image/png") && manifest.icons.some(icon => icon.src === "/icons/icon-512.png" && icon.sizes === "512x512" && icon.type === "image/png"));
check("Manifest exposes useful shortcuts", Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 2 && manifest.shortcuts.some(item => item.url === "/?action=recommend") && manifest.shortcuts.some(item => item.url === "/?action=queue"));
check("Manifest shortcuts use PNG icons", manifest.shortcuts.every(item => item.icons?.some(icon => icon.src === "/icons/icon-192.png" && icon.type === "image/png")));

check("Client uses a real audio element", app.includes("new Audio()"));
check("Client has no synthetic audio or alert fallback", forbiddenClientAudio.every(token => !app.includes(token)));
check("Client calls recommendation endpoint", app.includes("/api/music/recommend"));
check("Client restores busy state after recommendation", app.includes("async function recommend") && app.includes("finally") && app.includes("setBusy(false)"));
check("Client handles network fetch failure", app.includes("网络连接不稳定，请稍后再试。"));
check("Client times out API requests", app.includes("const API_TIMEOUT_MS") && app.includes("async function fetchWithTimeout") && app.includes("CLIENT_TIMEOUT") && app.includes("请求超时了，请稍后再试。"));
check("Client tracks PWA install prompt", app.includes("beforeinstallprompt") && app.includes("deferredInstallPrompt") && app.includes("appinstalled"));
check("Client handles PWA shortcut actions", app.includes("function shortcutAction") && app.includes("function handleShortcutAction") && app.includes('action === "recommend"') && app.includes('action === "queue"') && app.includes("history.replaceState") && app.includes("function revealAndFocus") && app.includes("scrollTop"));
check("Client can apply waiting service worker updates", app.includes("function applyServiceWorkerUpdate") && app.includes("promptServiceWorkerRefresh") && app.includes("controllerchange") && app.includes("window.location.reload()") && app.includes('postMessage({ type: "SKIP_WAITING" })'));
check("Client tracks online and offline status", app.includes('window.addEventListener("online"') && app.includes('window.addEventListener("offline"') && app.includes("navigator.onLine"));
check("Client resyncs when page resumes", app.includes("async function resumeRealtimeSync") && app.includes('resumeRealtimeSync("online")') && app.includes('resumeRealtimeSync("visible")'));
check("Client renders real service health", app.includes("refreshServiceHealth") && app.includes("/api/health") && app.includes("formatServiceHealth"));
check("Client reports service worker cache state", app.includes("swRegistration") && app.includes("缓存就绪") && app.includes("刷新可更新"));
check("Client syncs light theme to document element", app.includes("document.documentElement.classList.toggle(\"light\""));
check("Client syncs browser theme color", html.includes('id="themeColorMeta"') && app.includes("const THEME_COLORS") && app.includes("function applyTheme") && app.includes("themeColorMeta"));
check("Client supports favorites", app.includes("/api/user/favorite") && html.includes("我的收藏"));
check("Client supports recent plays", app.includes("/api/user/history") && html.includes("最近播放"));
check("Client supports preferences", app.includes("/api/user/preferences") && html.includes("喜欢的歌手"));
check("Client supports local queue filtering", html.includes("queueSearch") && app.includes("function queueSearchText") && app.includes("queueSearchTerm") && app.includes("没有匹配的歌曲"));
check("Client can copy current track", html.includes("copyTrackBtn") && app.includes("function currentTrackShareText") && app.includes("navigator.clipboard?.writeText") && app.includes("已复制当前歌曲"));
check("Client can copy filtered queue", html.includes("copyQueueBtn") && app.includes("function queueForSharing") && app.includes("function copyQueue") && app.includes("已复制筛选队列"));
check("Client can refresh the local library", html.includes("refreshLibraryBtn") && app.includes("async function refreshLibrary") && app.includes("/api/library/refresh") && app.includes("曲库已刷新"));
check("Client can export local profile", html.includes("exportProfileBtn") && app.includes("async function exportProfile") && app.includes("/api/user/profile") && app.includes("URL.createObjectURL") && app.includes("anchor.download") && app.includes("已导出本地资料"));
check("Client can import local profile", html.includes("importProfileBtn") && html.includes("importProfileInput") && app.includes("async function importProfileFile") && app.includes("FileReader") && app.includes("function profileImportSummaryText") && app.includes("async function restoreProfileBackup") && app.includes("/api/user/profile/restore") && app.includes('method: "POST"') && app.includes("已导入本地资料"));
check("Client shows recent profile backups", html.includes("profileBackupList") && html.includes('aria-live="polite"') && html.includes("refreshBackupsBtn") && app.includes("async function refreshProfileBackups") && app.includes("function renderProfileBackups") && app.includes('item.setAttribute("aria-label"') && app.includes("els.refreshBackupsBtn.disabled = true") && app.includes("els.refreshBackupsBtn.disabled = false") && app.includes("/api/user/profile/backups") && styles.includes(".profile-backup-item"));
check("Client documents queue and copy shortcuts", html.includes("<kbd>/</kbd>") && html.includes("筛选播放队列") && html.includes("<kbd>C</kbd>") && html.includes("复制当前歌曲"));
check("Client handles queue and copy shortcuts", app.includes('event.key === "/"') && app.includes("activeElement === els.messageInput") && app.includes("els.queueSearch?.focus") && app.includes('event.key === "c"') && app.includes("copyCurrentTrack().catch"));
check("Shortcut dialog has accessible focus management", html.includes('role="dialog"') && html.includes('aria-modal="true"') && html.includes('aria-labelledby="shortcutTitle"') && app.includes("shortcutReturnFocus") && app.includes("els.closeShortcutBtn.focus") && app.includes("shortcutReturnFocus !== document.body ? shortcutReturnFocus : els.messageInput"));
check("Shortcut dialog traps keyboard focus", app.includes("function trapShortcutFocus") && app.includes('event.key === "Tab"') && app.includes("shortcutFocusableElements") && app.includes("els.shortcutOverlay.contains(activeElement)"));
check("Client supports persisted settings", app.includes("/api/user/settings"));
check("Client persists repeat mode", app.includes("saveSettings({ repeatMode })") && app.includes("settings.repeatMode") && app.includes("updateRepeatUi()"));
check("Client has DeepSeek settings form", html.includes("DeepSeek 设置") && app.includes("/api/ai/config"));
check("Client keeps admin token optional in AI settings", html.includes("adminTokenRow") && html.includes("adminTokenInput") && app.includes("function adminTokenHeaders") && app.includes('"X-Claudio-Token"') && app.includes("adminTokenRequired") && styles.includes(".admin-token-row[hidden]"));
check("Styles include memory and quick panels", styles.includes(".memory-settings") && styles.includes(".quick-panel"));
check("Styles include queue filter controls", styles.includes(".queue-filter") && styles.includes(".queue-filter input") && styles.includes(".queue-filter button"));
check("Styles include top status strip", styles.includes(".status-strip") && styles.includes(".status-chip") && styles.includes(".install-button"));
check("Styles apply light theme to html and body", styles.includes("html.light,\nbody.light"));
check("Styles include responsive workspace layouts", styles.includes("@media (max-width: 1180px)") && styles.includes("@media (max-width: 900px)") && styles.includes("@media (max-width: 420px)"));
check("Styles respect reduced motion", styles.includes("@media (prefers-reduced-motion: reduce)") && styles.includes("animation-duration: 0.01ms"));
check("Styles have no duplicate hide button fragment", !styles.includes(".hide-button:hover {\n  background: var(--panel-muted);"));

check("Server exposes health endpoint", server.includes("/api/health"));
check("Health exposes non-sensitive sources", server.includes("sources: musicSourcesState()") && server.includes("localFiles") && server.includes("checks"));
check("Health exposes runtime metadata", server.includes("STARTED_AT") && server.includes("uptimeSeconds") && server.includes("process.pid"));
check("Health reports actual profile storage state", server.includes("function profileStorageState") && server.includes("directoryWritable") && server.includes("fs.accessSync(USER_DIR") && server.includes("fs.accessSync(PROFILE_PATH") && server.includes("storage: {\n        profile: profileStorage") && server.includes("profileWritable: profileStorage.writable"));
check("Health does not expose DeepSeek secret", !/apiKey\s*:\s*deepSeekConfig\.apiKey/.test(server));
check("Server exposes user profile endpoint", server.includes("/api/user/profile"));
check("Server can import user profile safely", server.includes('["GET", "HEAD", "POST"]') && server.includes("function profileImportSummary") && server.includes('reason: "profile-import"') && server.includes("userProfile = normalizeProfile(input)") && server.includes("broadcastState(\"now\", payload)") && server.includes("summary, backupPath, state: payload"));
check("Server backs up profile before import", server.includes("const PROFILE_BACKUP_DIR") && server.includes("const PROFILE_BACKUP_LIMIT = 5") && server.includes("const PROFILE_BACKUP_NAME_RE") && server.includes("function backupProfileBeforeImport") && server.includes("function pruneProfileBackups") && server.includes("PROFILE_BACKUP_NAME_RE.test(name)") && server.includes("fs.existsSync(path.join(PROFILE_BACKUP_DIR, backupName))") && server.includes("backupPath"));
check("Server lists recent profile backups safely", server.includes('"/api/user/profile/backups", defineRoutePolicy(["GET", "HEAD"], { sameOriginGet: true })') && server.includes("function publicProfileBackups") && server.includes("function profileBackups") && server.includes("profileBackups(Number.POSITIVE_INFINITY)") && server.includes(".flatMap(name =>") && server.includes("stat.isFile()") && server.includes("createdAt") && server.includes("size"));
check("Server can restore a profile backup safely", server.includes('"/api/user/profile/restore", defineRoutePolicy(["POST"])') && server.includes("function resolveProfileBackupPath") && server.includes("PROFILE_BACKUP_NAME_RE.test(name)") && server.includes('reason: "profile-restore"') && server.includes("备份文件已损坏，无法恢复"));
check("Server exposes favorite endpoint", server.includes("/api/user/favorite"));
check("Server exposes history endpoint", server.includes("/api/user/history"));
check("Server exposes preferences endpoint", server.includes("/api/user/preferences"));
check("Server exposes settings endpoint", server.includes("/api/user/settings"));
check("Server exposes AI status endpoint", server.includes("/api/ai/status"));
check("Server exposes AI config endpoint", server.includes("/api/ai/config"));
check("Server exposes music play endpoint", server.includes("/api/music/play"));
check("Server exposes library refresh endpoint", server.includes('"/api/library/refresh", defineRoutePolicy(["POST"])') && server.includes("function refreshMusicLibrary") && server.includes('reason: "library-refresh"'));
check("Server imports shared HTTP helpers", server.includes('} = require("./lib/http")') && server.includes("sendJson") && server.includes("getBody"));
check("HTTP helper exposes unified error payload", httpHelpers.includes("function errorPayload") && httpHelpers.includes("ok: false") && httpHelpers.includes("code: error?.code"));
check("HTTP helper can send error response headers", httpHelpers.includes("function sendError(res, status, error, extra = {}, headers = {})") && httpHelpers.includes("sendJson(res, status, errorPayload(error, extra), headers)"));
check("HTTP helper can omit bodies for HEAD", httpHelpers.includes("res.headOnly ? undefined : body") && httpHelpers.includes("res.headOnly ? undefined : text"));
check("Server uses friendly no-playable error", server.includes("NO_PLAYABLE_MUSIC") && server.includes("没有找到可播放的真实音乐"));
check("Server has unified parameter helpers", server.includes("function asString") && server.includes("function asNumber") && server.includes("function asBoolean"));
check("Server has strict validation helpers", server.includes("function requireString") && server.includes("function optionalNumber") && server.includes("function validationError"));
check("HTTP helper exposes validation fields safely", httpHelpers.includes("payload.fields = error.details.fields") && server.includes("VALIDATION_ERROR"));
check("HTTP helper rejects non-JSON request bodies", httpHelpers.includes("function isJsonContentType") && httpHelpers.includes("UNSUPPORTED_MEDIA_TYPE"));
check("Server validates DeepSeek apiBase as HTTPS URL", server.includes("function normalizeHttpsBase") && server.includes("parsed.protocol !== \"https:\""));
check("Server validates playback parameters", server.includes("optionalNumber(body.index, \"index\"") && server.includes("optionalBoolean(body.playing, \"playing\"") && server.includes("optionalNumber(body.volume, \"volume\""));
check("Server persists repeat mode setting", server.includes("repeatMode: 0") && server.includes("settings.repeatMode") && server.includes("Math.max(0, Math.min(2"));
check("Server validates chat messages", server.includes("requireString(body.message, \"message\"") && server.includes("maxLength: 200"));
check("Server supports queue remove by trackId", server.includes("optionalString(body.trackId, \"trackId\"") && server.includes("TRACK_NOT_FOUND"));
check("Server uses path.resolve for public path", server.includes("path.resolve(filePath)") && server.includes("function isPathInsideRoot"));
check("Server handles invalid URL encoding safely", server.includes("function safeDecodeURIComponent") && server.includes("INVALID_URL_ENCODING"));
check("Server compares path roots case-insensitively on Windows", server.includes('process.platform === "win32"') && server.includes("toLowerCase()") && server.includes("isPathInsideRoot(resolved, publicRoot)"));
check("Server correlates logs and JSON with requestId", server.includes("crypto.randomUUID().slice(0, 8)") && server.includes("res.requestId") && server.includes("logRequest(requestId"));
check("Server applies baseline browser security headers", server.includes("const SECURITY_HEADERS") && server.includes("Content-Security-Policy") && server.includes("X-Content-Type-Options") && server.includes("function applySecurityHeaders") && server.includes("applySecurityHeaders(this)"));
check("Server handles static HEAD and method allow semantics", server.includes("function methodNotAllowed") && server.includes("function endHead") && server.includes('!["GET", "HEAD"].includes(req.method)') && server.includes("Allow: allowed"));
check("Server parses numeric environment config safely", server.includes("function parseEnvNumber") && server.includes("const NUMERIC_ENV_STATE") && server.includes("function publicNumericEnvState") && server.includes("function healthConfigState"));
check("Server returns 405 for known API wrong methods", server.includes("const ROUTE_POLICIES") && server.includes("function routePolicy") && server.includes("function sendApiMethodNotAllowed") && server.includes("METHOD_NOT_ALLOWED") && server.includes("Allow: apiAllowHeader(methods)"));
check("Server supports HEAD only on safe API reads", server.includes('["GET", "HEAD"]') && server.includes('res.headOnly = req.method === "HEAD"') && server.includes('const method = req.method === "HEAD" ? "GET" : req.method') && server.includes('["GET"]'));
check("Server consolidates API route policy flags", server.includes("function defineRoutePolicy") && server.includes("publicCors: false") && server.includes("sameOriginGet: false") && server.includes("stateChangingGet: false"));
check("Server rejects cross-origin browser writes", server.includes("function requireSameOrigin") && server.includes("FORBIDDEN_ORIGIN") && server.includes("allowedMethods.includes(req.method)") && server.includes('!["GET", "HEAD"].includes(req.method)') && server.indexOf("requireSameOrigin(req)") < server.indexOf("const method = req.method === \"HEAD\" ? \"GET\" : req.method"));
check("Server protects same-origin-only API reads", server.includes('"/api/user/profile", defineRoutePolicy(["GET", "HEAD", "POST"], { sameOriginGet: true })') && server.includes('"/api/user/profile/backups", defineRoutePolicy(["GET", "HEAD"], { sameOriginGet: true })') && server.includes("policy?.sameOriginGet") && server.includes("FORBIDDEN_ORIGIN"));
check("Server protects state-changing GET routes", server.includes('"/api/next", defineRoutePolicy(["GET", "POST"], { stateChangingGet: true })') && server.includes('"/api/previous", defineRoutePolicy(["GET", "POST"], { stateChangingGet: true })') && server.includes("policy?.stateChangingGet"));
check("Client uses POST for track navigation", app.includes('api("/api/next", { method: "POST"') && app.includes('api("/api/previous", { method: "POST"'));
check("Server supports POST as primary track navigation", server.includes('["GET", "POST"]') && server.includes("function isLegacyNavigationGet") && server.includes('url.searchParams.get("legacy") === "1"') && server.includes('moveTrack(1, "next")') && server.includes('moveTrack(-1, "previous")') && server.includes("req.method === \"GET\" && policy?.stateChangingGet"));
check("Server limits public API CORS to health checks", server.includes('"/api/health", defineRoutePolicy(["GET", "HEAD"], { publicCors: true })') && server.includes("if (policy?.publicCors)") && server.includes("applyApiCorsHeaders(res, policy)") && !server.includes('"Access-Control-Allow-Origin": "*"'));
check("Server supports API CORS preflight", server.includes('req.method === "OPTIONS"') && server.includes("function applyApiCorsHeaders") && server.includes("Access-Control-Allow-Methods") && server.includes("Access-Control-Allow-Headers") && server.includes("function apiAllowHeader"));
check("Package exposes real HTTP smoke test", read("package.json").includes('"smoke:http": "node scripts/smoke-http.js"'));
check("Package exposes HTTP helper smoke test", read("package.json").includes('"smoke:http-helpers": "node scripts/smoke-http-helpers.js"'));
check("Package exposes UI smoke test", read("package.json").includes('"smoke:ui": "node scripts/smoke-ui.js"'));
check("Package verify runs UI smoke", read("package.json").includes('"verify": "npm test && npm run smoke:ui"'));

check("Client has validation field support", app.includes("error.fields = payload.fields") && app.includes("function validationSummary"));
check("Client optimizes unchanged queue renders", app.includes("els.queueList.dataset.signature") && app.includes("return;"));
check("Client updates sleep timer expanded state", app.includes("aria-expanded") && app.includes("els.sleepBtn.setAttribute"));
check("CSS keeps queue remove visible on small screens", styles.includes(".queue-item .remove-btn") && styles.includes("grid-column: 3"));
check("CSS has keyboard focus visibility", styles.includes(":focus-visible") && styles.includes(".queue-item:focus-visible"));
check("CSS supports multiline toast errors", styles.includes("white-space: pre-line") && styles.includes("overflow-wrap: anywhere"));
check("Client limits toast stack", app.includes("const MAX_TOASTS = 3") && app.includes("toast.setAttribute(\"role\"") && app.includes("els.toastContainer.children.length > MAX_TOASTS"));
check("Client syncs toast animation with timeout", app.includes("toast.style.setProperty(\"--toast-visible-ms\"") && styles.includes("var(--toast-visible-ms, 3700ms)"));
check("CSS keeps mobile toasts away from topbar", styles.includes("bottom: calc(12px + env(safe-area-inset-bottom))") && styles.includes("flex-direction: column-reverse"));
check("Client renders message and queue data with DOM APIs", app.includes("function textElement") && app.includes("function queueTrackText") && app.includes("els.messages.replaceChildren()") && app.includes("els.queueList.replaceChildren()") && app.includes("els.playIcon.innerHTML") && !app.includes("wrapper.innerHTML") && !app.includes("item.innerHTML"));
check("HTTP helper smoke covers body parsing and HEAD helpers", read("scripts/smoke-http-helpers.js").includes("getBody parses JSON body") && read("scripts/smoke-http-helpers.js").includes("UNSUPPORTED_MEDIA_TYPE") && read("scripts/smoke-http-helpers.js").includes("sendJson HEAD omits body") && read("scripts/smoke-http-helpers.js").includes("sendText HEAD omits body"));
check("UI smoke captures desktop, mobile widths, and light theme", read("scripts/smoke-ui.js").includes("claudio-desktop.png") && read("scripts/smoke-ui.js").includes("claudio-mobile-320.png") && read("scripts/smoke-ui.js").includes("claudio-mobile.png") && read("scripts/smoke-ui.js").includes("claudio-mobile-414.png") && read("scripts/smoke-ui.js").includes("claudio-light-desktop.png") && read("scripts/smoke-ui.js").includes("assertLightViewport"));
check("UI smoke guards against horizontal and control overflow", read("scripts/smoke-ui.js").includes("scrollWidth > metrics.clientWidth") && read("scripts/smoke-ui.js").includes("overflowingElements"));

check("Client has tryRefresh render call", app.includes("const data = await api(\"/api/now\")") && app.includes("render(data)"));
check("Client reconnects SSE after errors", app.includes("STREAM_RECONNECT_DELAYS") && app.includes("scheduleEventStreamReconnect") && app.includes("eventStream.addEventListener(\"error\""));
check("Client has MediaMetadata safety check", app.includes("typeof MediaMetadata !== \"undefined\""));
check("Client has retry by status code", app.includes("[502, 503, 504].includes(error.status)") && app.includes("error.code === \"UPSTREAM_TIMEOUT\""));
check("Client has phased loading feedback", app.includes("setLoadingPhase") && app.includes("正在解析意图"));
check("Client hides remove button for local tracks", app.includes("const canRemove = track.source !== \"local\""));
check("Client has audio failure recovery", app.includes("function handlePlaybackFailure") && app.includes("await nextTrack(true)"));
check("Client supports queue clear undo toast action", app.includes("function restoreClearedQueue") && app.includes("toast-action"));
check("Client limits long queue renders", app.includes("QUEUE_RENDER_LIMIT") && app.includes("visibleQueue = filteredQueue.slice"));
check("Server supports audio range streaming", server.includes("function serveAudioFile") && server.includes("Content-Range") && server.includes("Accept-Ranges"));
check("Server exposes lightweight now state", server.includes("function publicNowState") && server.includes("/api/now-lite"));
check("Server broadcasts state to SSE clients", server.includes("const sseClients = new Set()") && server.includes("function broadcastState") && server.includes("ensureSseHeartbeat"));
check("Server closes SSE clients on shutdown", server.includes("function closeSseClients") && server.includes('closeSseClients("shutdown"'));
check("Server caches music search results", server.includes("const searchCache = new Map()") && server.includes("SEARCH_CACHE_TTL_MS") && server.includes("setSearchCache(cacheKey"));
check("Server limits recommendation concurrency", server.includes("RECOMMENDATION_CONCURRENCY") && server.includes("runLimited(queries"));
check("Server keeps AI admin token optional for local use", server.includes("CLAUDIO_REQUIRE_ADMIN_TOKEN") && server.includes("adminTokenRequired: REQUIRE_ADMIN_TOKEN") && server.includes("adminTokenConfigured: Boolean(ADMIN_TOKEN)") && server.includes("if (!REQUIRE_ADMIN_TOKEN) return") && server.includes("ADMIN_TOKEN_REQUIRED") && server.includes("CLAUDIO_ADMIN_TOKEN") && server.includes("x-claudio-token"));
check("Server configures HTTP timeouts", server.includes("server.requestTimeout") && server.includes("server.headersTimeout") && server.includes("server.keepAliveTimeout"));
check("Server handles client parser errors", server.includes('server.on("clientError"') && server.includes("400 Bad Request"));
check("Server has graceful shutdown path", server.includes("function shutdown(signal)") && server.includes("server.close") && server.includes("SIGTERM"));
check("HTTP smoke verifies SSE shutdown", read("scripts/smoke-http.js").includes("openSse") && read("scripts/smoke-http.js").includes("Server exits on SIGTERM with an open SSE client"));

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
