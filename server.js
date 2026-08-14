const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  createAppError,
  publicErrorMessage,
  sendJson,
  sendError,
  sendText,
  getBody
} = require("./lib/http");

const ROOT = __dirname;

function loadEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    raw.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const index = trimmed.indexOf("=");
      if (index < 1) return;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    });
  } catch {
    // .env is optional.
  }
}

if (process.env.CLAUDIO_SKIP_ENV !== "1") loadEnvFile(path.join(ROOT, ".env"));

const NUMERIC_ENV_STATE = {};

function parseEnvNumber(name, defaultValue, options = {}) {
  const { min = -Infinity, max = Infinity, integer = false } = options;
  const fallback = Number(defaultValue);
  const raw = process.env[name];
  let value = fallback;
  let source = "default";
  let valid = true;

  if (raw != null && raw !== "") {
    source = "env";
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
      source = "default";
      valid = false;
    } else {
      value = parsed;
    }
  }

  NUMERIC_ENV_STATE[name] = { value, defaultValue: fallback, source, valid };
  return value;
}

function publicNumericEnvState(name) {
  const state = NUMERIC_ENV_STATE[name] || {};
  return {
    value: state.value,
    defaultValue: state.defaultValue,
    source: state.source || "default",
    valid: state.valid !== false
  };
}

const PORT = parseEnvNumber("PORT", 3000, { min: 1, max: 65535, integer: true });
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const MUSIC_DIR = path.join(ROOT, "music");
const USER_DIR = path.join(ROOT, "user");
const PROFILE_PATH = path.join(USER_DIR, "profile.json");
const PROFILE_BACKUP_DIR = path.join(USER_DIR, "backups");

const AUDIUS_API_BASE = "https://api.audius.co/v1";
const ITUNES_API_BASE = "https://itunes.apple.com";
const DEEZER_API_BASE = "https://api.deezer.com";
const RADIO_BROWSER_BASE = "https://de1.api.radio-browser.info";
function fileVersion(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}-${Math.floor(stat.mtimeMs)}`;
  } catch {
    return String(Date.now());
  }
}

const APP_NAME = "ClaudioMusic";
const STARTED_AT = new Date();
const APP_VERSION = process.env.CLAUDIO_APP_VERSION || fileVersion(__filename);
const FRONTEND_VERSION = process.env.CLAUDIO_FRONTEND_VERSION || [
  fileVersion(path.join(PUBLIC_DIR, "index.html")),
  fileVersion(path.join(PUBLIC_DIR, "styles.css")),
  fileVersion(path.join(PUBLIC_DIR, "app.js")),
  fileVersion(path.join(PUBLIC_DIR, "service-worker.js"))
].join(".");
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"];
const HISTORY_LIMIT = 50;
const FAVORITE_LIMIT = 200;
const PREFERENCE_LIMIT = 30;
const MAX_MESSAGES = 200;
const DYNAMIC_TRACKS_LIMIT = 200;
const PROFILE_BACKUP_LIMIT = 5;
const PROFILE_BACKUP_NAME_RE = /^profile-\d{8}T\d{6}Z(?:-\d+)?\.json$/;

const deepSeekConfig = {
  apiKey: process.env.DEEPSEEK_API_KEY || "",
  apiBase: (process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com").replace(/\/+$/, ""),
  model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
};
const DEEPSEEK_TIMEOUT_MS = parseEnvNumber("DEEPSEEK_TIMEOUT_MS", 10000, { min: 1000, max: 120000, integer: true });
const DEEPSEEK_MAX_TOKENS = parseEnvNumber("DEEPSEEK_MAX_TOKENS", 260, { min: 1, max: 4000, integer: true });
const REQUEST_TIMEOUT_MS = parseEnvNumber("CLAUDIO_REQUEST_TIMEOUT_MS", 30_000, { min: 1000, max: 600_000, integer: true });
const HEADERS_TIMEOUT_MS = parseEnvNumber("CLAUDIO_HEADERS_TIMEOUT_MS", 35_000, { min: 1000, max: 600_000, integer: true });
const KEEP_ALIVE_TIMEOUT_MS = parseEnvNumber("CLAUDIO_KEEP_ALIVE_TIMEOUT_MS", 5_000, { min: 1000, max: 120_000, integer: true });
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_LIMIT = 120;
const RECOMMENDATION_CONCURRENCY = 2;
const ADMIN_TOKEN = process.env.CLAUDIO_ADMIN_TOKEN || "";
const REQUIRE_ADMIN_TOKEN = asBoolean(process.env.CLAUDIO_REQUIRE_ADMIN_TOKEN, false);
const HOST = process.env.CLAUDIO_HOST || process.env.HOST || "127.0.0.1";

function isLoopbackHostOnly() {
  const h = (HOST || "").toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "media-src 'self' https: data: blob:",
    "connect-src 'self' http://127.0.0.1:* http://localhost:* https:",
    "manifest-src 'self'",
    "worker-src 'self'"
  ].join("; ")
};
const SHORT_STATIC_CACHE = "public, max-age=300";
const VERSIONED_STATIC_CACHE = "public, max-age=31536000, immutable";

const recommendationSeeds = {
  daily: ["lofi chill", "indie pop", "dream pop", "acoustic morning", "jazzhop"],
  happy: ["feel good indie", "upbeat pop", "funk groove", "summer indie", "city pop"],
  relaxed: ["lofi chill", "soft indie", "downtempo", "acoustic chill", "quiet piano"],
  focus: ["lofi focus", "instrumental hip hop", "jazzhop focus", "ambient piano", "study beats"],
  sad: ["sad indie", "melancholy acoustic", "dream pop", "soft piano", "rainy day music"],
  night: ["late night jazz", "night drive", "soul night", "ambient piano", "bedroom pop"],
  chinese: ["mandopop", "chinese pop", "taiwan indie", "c-pop", "chinese indie"]
};

const defaultProfile = {
  favorites: [],
  history: [],
  preferences: {
    artists: [],
    genres: [],
    scenes: [],
    avoid: []
  },
  settings: {
    theme: "dark",
    volume: 0.68,
    repeatMode: 0,
    lastPrompt: "",
    lastScene: ""
  }
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonAt(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAt(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function fileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function readDataJson(fileName, fallback) {
  return readJsonAt(path.join(DATA_DIR, fileName), fallback);
}

function stringList(value, limit = PREFERENCE_LIMIT) {
  const input = Array.isArray(value) ? value : String(value || "").split(/[，,;；\n]/);
  const items = [];
  input.forEach(item => {
    const cleaned = String(item || "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (cleaned && !items.some(existing => existing.toLowerCase() === cleaned.toLowerCase())) items.push(cleaned);
  });
  return items.slice(0, limit);
}

function asString(value, options = {}) {
  const { trim = true, maxLength = 500, defaultValue = "" } = options;
  if (value == null) return defaultValue;
  let result = String(value);
  if (trim) result = result.trim();
  if (maxLength > 0) result = result.slice(0, maxLength);
  return result || defaultValue;
}

function asNumber(value, options = {}) {
  const { min = -Infinity, max = Infinity, integer = false, defaultValue = 0 } = options;
  const num = Number(value);
  if (!Number.isFinite(num)) return defaultValue;
  const clamped = Math.max(min, Math.min(max, num));
  return integer ? Math.round(clamped) : clamped;
}

function asBoolean(value, defaultValue = false) {
  if (value == null) return defaultValue;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return defaultValue;
}

function requireAdmin(req) {
  if (!REQUIRE_ADMIN_TOKEN) return;
  if (!ADMIN_TOKEN) throw createAppError("管理员授权已开启，但 CLAUDIO_ADMIN_TOKEN 未配置。", 500, "ADMIN_TOKEN_REQUIRED");
  const token = req.headers["x-claudio-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (token === ADMIN_TOKEN) return;
  throw createAppError("需要管理员授权。", 401, "UNAUTHORIZED");
}

function requestOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    return parsed.origin;
  } catch {
    return "invalid";
  }
}

function sameServerOrigin(req, origin) {
  if (!origin) return true;
  if (origin === "invalid") return false;
  const protocol = req.socket.encrypted ? "https:" : "http:";
  const host = req.headers.host || `127.0.0.1:${activePort}`;
  const hostName = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0] || host;
  const loopbackNames = ["localhost", "127.0.0.1", "::1", "0.0.0.0"];
  if (!loopbackNames.includes(hostName.toLowerCase())) return false;
  return origin === `${protocol}//${host}`;
}

function requireSameOrigin(req) {
  if (sameServerOrigin(req, requestOrigin(req))) return;
  throw createAppError("这个操作只允许来自当前 Claudio 页面。", 403, "FORBIDDEN_ORIGIN");
}

function validationError(fields, message = "请求参数无效。") {
  return createAppError(message, 400, "VALIDATION_ERROR", { fields });
}

function requireString(value, field, options = {}) {
  const { minLength = 1, maxLength = 500, label = field, pattern } = options;
  if (value == null) throw validationError({ [field]: `${label}不能为空。` });
  const raw = String(value).trim();
  if (raw.length < minLength) throw validationError({ [field]: `${label}不能为空。` });
  if (raw.length > maxLength) throw validationError({ [field]: `${label}不能超过 ${maxLength} 个字符。` });
  if (pattern && !pattern.test(raw)) throw validationError({ [field]: `${label}格式不正确。` });
  return raw;
}

function optionalString(value, field, options = {}) {
  const { maxLength = 500, defaultValue = "", label = field, pattern } = options;
  if (value == null || value === "") return defaultValue;
  return requireString(value, field, { minLength: 0, maxLength, label, pattern });
}

function requireNumber(value, field, options = {}) {
  const { min = -Infinity, max = Infinity, integer = false, label = field } = options;
  const num = Number(value);
  if (!Number.isFinite(num)) throw validationError({ [field]: `${label}必须是数字。` });
  if (integer && !Number.isInteger(num)) throw validationError({ [field]: `${label}必须是整数。` });
  if (num < min || num > max) throw validationError({ [field]: `${label}必须在 ${min} 到 ${max} 之间。` });
  return num;
}

function optionalNumber(value, field, options = {}) {
  if (value == null || value === "") return options.defaultValue;
  return requireNumber(value, field, options);
}

function requireBoolean(value, field, options = {}) {
  const { label = field } = options;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  throw validationError({ [field]: `${label}必须是布尔值。` });
}

function optionalBoolean(value, field, defaultValue = undefined) {
  if (value == null || value === "") return defaultValue;
  return requireBoolean(value, field);
}

function normalizeHttpsBase(value, field, defaultValue) {
  const raw = optionalString(value, field, { maxLength: 500, defaultValue, label: "接口地址" }).replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw validationError({ [field]: "接口地址必须是有效 URL。" });
  }
  const hostname = parsed.hostname.toLowerCase();
  const loopbackHosts = ["localhost", "127.0.0.1", "::1", "0.0.0.0"];
  const isLoopback = loopbackHosts.includes(hostname);
  if (parsed.protocol !== "https:" && !isLoopback) throw validationError({ [field]: "接口地址必须使用 https（本地地址允许 http）。" });
  const is172Private = /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname);
  const isPrivateRange = hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname.startsWith("169.254.") || hostname.startsWith("fe80:") || is172Private || hostname.endsWith(".local");
  if (!isLoopback && isPrivateRange) throw validationError({ [field]: "接口地址不能使用内网或保留地址。" });
  if (parsed.username || parsed.password) throw validationError({ [field]: "接口地址不能包含用户名或密码。" });
  return raw;
}

function sanitizeTrackSnapshot(track) {
  if (!track || !track.id) return null;
  const snapshot = {
    id: String(track.id).slice(0, 120),
    title: String(track.title || "Untitled").slice(0, 160),
    artist: String(track.artist || "Unknown Artist").slice(0, 160),
    album: String(track.album || "").slice(0, 160),
    duration: Math.max(0, Math.min(86400, Number(track.duration || 0))),
    source: String(track.source || "unknown").slice(0, 40),
    audioUrl: String(track.audioUrl || "").slice(0, 1000),
    audioMode: String(track.audioMode || "").slice(0, 80),
    note: String(track.note || "").slice(0, 240),
    artwork: track.artwork ? String(track.artwork).slice(0, 1000) : null,
    permalink: track.permalink ? String(track.permalink).slice(0, 1000) : null,
    providerId: track.providerId ? String(track.providerId).slice(0, 160) : undefined,
    addedAt: track.addedAt || undefined,
    playedAt: track.playedAt || undefined,
    context: track.context ? String(track.context).slice(0, 160) : undefined
  };
  Object.keys(snapshot).forEach(key => snapshot[key] === undefined && delete snapshot[key]);
  return snapshot;
}

function normalizeProfile(raw = {}) {
  const settings = { ...defaultProfile.settings, ...(raw.settings || {}) };
  settings.theme = settings.theme === "light" ? "light" : "dark";
  settings.volume = Math.max(0, Math.min(1, Number(settings.volume ?? defaultProfile.settings.volume)));
  settings.repeatMode = Math.max(0, Math.min(2, Math.round(Number(settings.repeatMode ?? defaultProfile.settings.repeatMode))));
  settings.lastPrompt = String(settings.lastPrompt || "").slice(0, 160);
  settings.lastScene = String(settings.lastScene || "").slice(0, 80);

  return {
    favorites: Array.isArray(raw.favorites) ? raw.favorites.map(sanitizeTrackSnapshot).filter(Boolean).slice(0, FAVORITE_LIMIT) : [],
    history: Array.isArray(raw.history) ? raw.history.map(sanitizeTrackSnapshot).filter(Boolean).slice(0, HISTORY_LIMIT) : [],
    preferences: {
      artists: stringList(raw.preferences?.artists),
      genres: stringList(raw.preferences?.genres),
      scenes: stringList(raw.preferences?.scenes),
      avoid: stringList(raw.preferences?.avoid)
    },
    settings
  };
}

function loadProfile() {
  try {
    const raw = fs.readFileSync(PROFILE_PATH, "utf8");
    return normalizeProfile(JSON.parse(raw));
  } catch (error) {
    if (fs.existsSync(PROFILE_PATH)) {
      try { fs.renameSync(PROFILE_PATH, `${PROFILE_PATH}.corrupt-${Date.now()}`); } catch {}
      console.error(`user/profile.json 读取或解析失败，已备份损坏文件并回退默认值: ${error.message}`);
    }
    return defaultProfile;
  }
}

let userProfile = loadProfile();

function saveProfile() {
  userProfile = normalizeProfile(userProfile);
  writeJsonAt(PROFILE_PATH, userProfile);
  return userProfile;
}

function pruneProfileBackups(limit = PROFILE_BACKUP_LIMIT) {
  ensureDir(PROFILE_BACKUP_DIR);
  const backups = profileBackups(Number.POSITIVE_INFINITY);
  backups.slice(limit).forEach(backup => {
    try {
      fs.rmSync(backup.path, { force: true });
    } catch {}
  });
}

function profileBackups(limit = PROFILE_BACKUP_LIMIT) {
  ensureDir(PROFILE_BACKUP_DIR);
  return fs.readdirSync(PROFILE_BACKUP_DIR)
    .filter(name => PROFILE_BACKUP_NAME_RE.test(name))
    .flatMap(name => {
      const backupPath = path.join(PROFILE_BACKUP_DIR, name);
      try {
        const stat = fs.statSync(backupPath);
        if (!stat.isFile()) return [];
        return [{
          name,
          path: backupPath,
          backupPath: `user/backups/${name}`,
          createdAt: stat.mtime.toISOString(),
          size: stat.size,
          mtimeMs: stat.mtimeMs
        }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .slice(0, limit);
}

function publicProfileBackups() {
  return profileBackups().map(({ backupPath, createdAt, size }) => ({ backupPath, createdAt, size }));
}

function backupProfileBeforeImport() {
  ensureDir(PROFILE_BACKUP_DIR);
  const stamp = fileTimestamp();
  let backupName = `profile-${stamp}.json`;
  for (let index = 2; fs.existsSync(path.join(PROFILE_BACKUP_DIR, backupName)); index += 1) {
    backupName = `profile-${stamp}-${index}.json`;
  }
  const backupPath = path.join(PROFILE_BACKUP_DIR, backupName);
  writeJsonAt(backupPath, userProfile);
  pruneProfileBackups();
  return `user/backups/${backupName}`;
}

function trackIdFromFile(fileName) {
  return `local-${crypto.createHash("sha1").update(fileName).digest("hex").slice(0, 12)}`;
}

function titleFromFile(fileName) {
  return path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, " ").trim() || fileName;
}

function localFileTracks() {
  try {
    return fs.readdirSync(MUSIC_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile() && AUDIO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase()))
      .map(entry => ({
        id: trackIdFromFile(entry.name),
        title: titleFromFile(entry.name),
        artist: "本地音乐",
        duration: 180,
        source: "local",
        audioUrl: `/music/${encodeURIComponent(entry.name)}`,
        note: "Local music file"
      }));
  } catch {
    return [];
  }
}

let localFileCache = { tracks: [], timestamp: 0 };
function cachedLocalFileTracks() {
  const now = Date.now();
  if (now - localFileCache.timestamp < 30000) return localFileCache.tracks;
  localFileCache = { tracks: localFileTracks(), timestamp: now };
  return localFileCache.tracks;
}

let declaredTracksCache = { tracks: [], timestamp: 0 };
function cachedDeclaredTracks() {
  const now = Date.now();
  if (now - declaredTracksCache.timestamp < 30000) return declaredTracksCache.tracks;
  declaredTracksCache = { tracks: readDataJson("tracks.json", []), timestamp: now };
  return declaredTracksCache.tracks;
}

function refreshMusicLibrary() {
  localFileCache = { tracks: localFileTracks(), timestamp: Date.now() };
  declaredTracksCache = { tracks: readDataJson("tracks.json", []), timestamp: Date.now() };
  const list = allTracks();
  state.trackIndex = Math.min(state.trackIndex, Math.max(0, list.length - 1));
  return {
    localFiles: localFileCache.tracks.length,
    declaredTracks: declaredTracksCache.tracks.length,
    queueSize: list.length
  };
}

function localTracks() {
  const declared = cachedDeclaredTracks();
  const declaredAudio = new Set(declared.map(track => path.basename(String(track.audioUrl || ""))).filter(Boolean));
  return declared.concat(cachedLocalFileTracks().filter(track => !declaredAudio.has(path.basename(track.audioUrl))));
}

const state = {
  startedAt: Date.now(),
  trackIndex: 0,
  playing: false,
  volume: userProfile.settings.volume,
  dynamicTracks: [],
  hideLocalTracks: false,
  shuffledIndices: null,
  lastAi: null,
  messages: [
    {
      role: "ai",
      at: "00:00",
      text: "你好，我是 Claudio。告诉我你想听的歌、歌手、心情或风格，我会搜索真实音乐源并播放。"
    }
  ]
};

const sseClients = new Set();
let sseHeartbeat = null;

function allTracks() {
  const local = state.hideLocalTracks ? [] : localTracks();
  if (state.shuffledIndices && state.shuffledIndices.length === state.dynamicTracks.length) {
    const shuffledDyn = state.shuffledIndices.map(i => state.dynamicTracks[i]).filter(Boolean);
    return shuffledDyn.concat(local);
  }
  return state.dynamicTracks.concat(local);
}

function fileAudioUrl(track) {
  if (!track) return null;
  if (track.audioUrl) return track.audioUrl;
  for (const ext of AUDIO_EXTENSIONS) {
    const filePath = path.join(MUSIC_DIR, `${track.id}${ext}`);
    if (fs.existsSync(filePath)) return `/music/${encodeURIComponent(`${track.id}${ext}`)}`;
  }
  return null;
}

function audioModeFor(track, audioUrl) {
  if (!audioUrl) return "missing";
  if (track.source === "audius") return "audius";
  if (track.source === "itunes") return "itunes-preview";
  if (track.source === "deezer") return "deezer-preview";
  if (track.source === "radio" || track.source === "radio-browser") return "radio";
  return "file";
}

function isPlayableTrack(track) {
  return Boolean(track?.audioUrl && audioModeFor(track, track.audioUrl) !== "missing");
}

function isFavorite(trackOrId) {
  const id = typeof trackOrId === "string" ? trackOrId : trackOrId?.id;
  return Boolean(id && userProfile.favorites.some(track => track.id === id));
}

function withRuntime(track, favSet) {
  if (!track) return null;
  const audioUrl = fileAudioUrl(track);
  return {
    ...track,
    audioUrl,
    audioMode: audioModeFor(track, audioUrl),
    favorite: favSet instanceof Set ? favSet.has(track.id) : isFavorite(track.id)
  };
}

function currentTrack() {
  const favSet = new Set(userProfile.favorites.map(item => item.id));
  const tracks = allTracks().map(item => withRuntime(item, favSet));
  return tracks[state.trackIndex] || tracks[0] || null;
}

function elapsedSeconds(track = currentTrack()) {
  if (!track || !state.playing) return 0;
  return Math.floor((Date.now() - state.startedAt) / 1000) % Math.max(1, track.duration || 180);
}

function deepSeekEnabled() {
  return Boolean(deepSeekConfig.apiKey);
}

function aiPublicState(extra = {}) {
  return {
    provider: "DeepSeek",
    enabled: deepSeekEnabled(),
    model: deepSeekConfig.model,
    apiBase: deepSeekConfig.apiBase,
    configuredIn: deepSeekConfig.apiKey ? "runtime" : "none",
    adminTokenRequired: REQUIRE_ADMIN_TOKEN,
    adminTokenConfigured: Boolean(ADMIN_TOKEN),
    mode: "cheap-json-intent",
    last: state.lastAi,
    ...extra
  };
}

function publicProfile() {
  return {
    favorites: userProfile.favorites,
    history: userProfile.history,
    preferences: userProfile.preferences,
    settings: userProfile.settings,
    favoriteIds: userProfile.favorites.map(track => track.id)
  };
}

function profileImportSummary(profile = userProfile) {
  const preferences = profile.preferences || {};
  return {
    favorites: Array.isArray(profile.favorites) ? profile.favorites.length : 0,
    history: Array.isArray(profile.history) ? profile.history.length : 0,
    preferenceItems: ["artists", "genres", "scenes", "avoid"].reduce((total, key) => {
      const items = preferences[key];
      return total + (Array.isArray(items) ? items.length : 0);
    }, 0)
  };
}

function profileStorageState() {
  const storage = {
    path: "user/profile.json",
    directory: "user/",
    exists: false,
    readable: true,
    writable: false,
    directoryWritable: false
  };
  try {
    ensureDir(USER_DIR);
  } catch (error) {
    storage.readable = false;
    storage.error = error?.code || "PROFILE_DIR_ERROR";
    return storage;
  }

  try {
    fs.accessSync(USER_DIR, fs.constants.W_OK);
  } catch (error) {
    storage.error = error?.code || "PROFILE_DIR_NOT_WRITABLE";
    return storage;
  }
  storage.directoryWritable = true;

  storage.exists = fs.existsSync(PROFILE_PATH);
  if (!storage.exists) {
    storage.writable = storage.directoryWritable;
    return storage;
  }

  try {
    fs.accessSync(PROFILE_PATH, fs.constants.R_OK);
  } catch (error) {
    storage.readable = false;
    storage.error = error?.code || "PROFILE_NOT_READABLE";
  }
  try {
    fs.accessSync(PROFILE_PATH, fs.constants.W_OK);
    storage.writable = true;
  } catch (error) {
    storage.error = storage.error || error?.code || "PROFILE_NOT_WRITABLE";
  }

  return storage;
}

function localFileTrackCount() {
  return cachedLocalFileTracks().length;
}

function musicSourcesState() {
  return {
    audius: { enabled: true, role: "primary", kind: "full-track" },
    deezer: { enabled: true, role: "fallback", kind: "preview" },
    itunes: { enabled: true, role: "fallback", kind: "preview" },
    localFiles: { enabled: true, role: "owned-files", directory: "music/" },
    radioBrowser: { enabled: true, role: "explicit-radio-only" }
  };
}

function healthConfigState() {
  return {
    host: HOST,
    port: publicNumericEnvState("PORT"),
    deepSeek: {
      timeoutMs: publicNumericEnvState("DEEPSEEK_TIMEOUT_MS"),
      maxTokens: publicNumericEnvState("DEEPSEEK_MAX_TOKENS"),
      configured: deepSeekEnabled()
    },
    serverTimeouts: {
      requestTimeoutMs: publicNumericEnvState("CLAUDIO_REQUEST_TIMEOUT_MS"),
      headersTimeoutMs: publicNumericEnvState("CLAUDIO_HEADERS_TIMEOUT_MS"),
      keepAliveTimeoutMs: publicNumericEnvState("CLAUDIO_KEEP_ALIVE_TIMEOUT_MS")
    },
    admin: {
      tokenRequired: REQUIRE_ADMIN_TOKEN,
      tokenConfigured: Boolean(ADMIN_TOKEN)
    }
  };
}

function publicState(extra = {}) {
  const favSet = new Set(userProfile.favorites.map(item => item.id));
  const queue = allTracks().map(item => withRuntime(item, favSet));
  const now = queue[state.trackIndex] || queue[0] || null;
  return {
    app: APP_NAME,
    displayName: "Claudio Music",
    appVersion: APP_VERSION,
    frontendVersion: FRONTEND_VERSION,
    status: state.playing ? "ON AIR" : "PAUSED",
    now,
    elapsed: elapsedSeconds(now),
    queue,
    upcoming: queue
      .slice(state.trackIndex + 1)
      .concat(queue.slice(0, state.trackIndex))
      .slice(0, 6),
    volume: state.volume,
    messages: state.messages,
    ai: aiPublicState(),
    user: publicProfile(),
    musicApis: {
      primary: "Audius full tracks",
      preview: "Deezer and Apple iTunes previews",
      local: "User-owned files in music/",
      fallback: "Radio Browser only when radio is requested"
    },
    updatedAt: new Date().toISOString(),
    ...extra
  };
}

function publicNowState(extra = {}) {
  const now = currentTrack();
  return {
    app: APP_NAME,
    displayName: "Claudio Music",
    appVersion: APP_VERSION,
    frontendVersion: FRONTEND_VERSION,
    status: state.playing ? "ON AIR" : "PAUSED",
    now,
    elapsed: elapsedSeconds(now),
    volume: state.volume,
    queueSize: allTracks().length,
    ai: aiPublicState(),
    updatedAt: new Date().toISOString(),
    ...extra
  };
}

function ensureSseHeartbeat() {
  if (sseHeartbeat || !sseClients.size) return;
  sseHeartbeat = setInterval(() => {
    broadcastState("heartbeat", publicNowState({ reason: "heartbeat" }));
  }, 15000);
}

function stopSseHeartbeatIfIdle() {
  if (sseClients.size || !sseHeartbeat) return;
  clearInterval(sseHeartbeat);
  sseHeartbeat = null;
}

function closeSseClients(event = "shutdown", payload = { ok: false, reason: "shutdown" }) {
  for (const res of Array.from(sseClients)) {
    try {
      writeSse(res, event, payload);
      res.end();
    } catch {}
    sseClients.delete(res);
  }
  stopSseHeartbeatIfIdle();
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcastState(event = "now", payload = publicState()) {
  for (const res of Array.from(sseClients)) {
    try {
      writeSse(res, event, payload);
    } catch {
      sseClients.delete(res);
    }
  }
  stopSseHeartbeatIfIdle();
}

function sendState(res, extra = {}) {
  const payload = publicState(extra);
  sendJson(res, 200, payload);
  broadcastState("now", payload);
}

function apiUrl(base, endpoint, params = {}) {
  const clean = String(endpoint || "").replace(/^\/+/, "");
  const url = new URL(`${base.replace(/\/+$/, "")}/${clean}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url;
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "ClaudioMusic/1.0"
      }
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw createAppError(json.error?.message || `HTTP ${response.status}`, 502, "UPSTREAM_HTTP_ERROR");
    return json;
  } catch (error) {
    if (error.name === "AbortError") throw createAppError("上游音乐服务请求超时。", 504, "UPSTREAM_TIMEOUT");
    if (error.status) throw error;
    throw createAppError("上游音乐服务暂时不可用。", 502, "UPSTREAM_UNAVAILABLE", { upstream: error.message });
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(url, body, headers = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "ClaudioMusic/1.0",
        ...headers
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch (error) {
      throw createAppError("上游服务返回了不可解析的内容。", 502, "UPSTREAM_BAD_JSON", error.message);
    }
    if (!response.ok) throw createAppError(json.error?.message || `HTTP ${response.status}`, 502, "UPSTREAM_HTTP_ERROR");
    return json;
  } catch (error) {
    if (error.name === "AbortError") throw createAppError("上游服务请求超时。", 504, "UPSTREAM_TIMEOUT");
    if (error.status) throw error;
    throw createAppError("上游服务暂时不可用。", 502, "UPSTREAM_UNAVAILABLE", { upstream: error.message });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeAudius(track) {
  return {
    id: `audius-${track.id}`,
    providerId: track.id,
    title: track.title || "Untitled",
    artist: track.user?.name || track.user?.handle || "Audius",
    duration: Math.max(30, Number(track.duration || 180)),
    source: "audius",
    note: track.genre ? `Audius · ${track.genre}` : "Audius full track",
    genre: track.genre || "",
    artwork: track.artwork?.["480x480"] || track.artwork?.["150x150"] || null,
    permalink: track.permalink || null
  };
}

function normalizeItunes(track) {
  return {
    id: `itunes-${track.trackId}`,
    providerId: String(track.trackId),
    title: track.trackName || "Untitled",
    artist: track.artistName || "iTunes",
    album: track.collectionName || "",
    duration: Math.max(30, Math.round(Number(track.trackTimeMillis || 30000) / 1000)),
    source: "itunes",
    audioUrl: track.previewUrl || null,
    note: "Apple iTunes preview",
    artwork: track.artworkUrl100 || null,
    permalink: track.trackViewUrl || null
  };
}

function normalizeDeezer(track) {
  return {
    id: `deezer-${track.id}`,
    providerId: String(track.id),
    title: track.title || "Untitled",
    artist: track.artist?.name || "Deezer",
    album: track.album?.title || "",
    duration: Math.max(30, Number(track.duration || 30)),
    source: "deezer",
    audioUrl: track.preview || null,
    note: "Deezer preview",
    artwork: track.album?.cover_medium || track.album?.cover || null,
    permalink: track.link || null
  };
}

function normalizeRadio(station) {
  const stream = station.url_resolved || station.url;
  return {
    id: `radio-${station.stationuuid}`,
    providerId: station.stationuuid,
    title: station.name || "Internet Radio",
    artist: station.tags || station.country || "Radio Browser",
    duration: 3600,
    source: "radio-browser",
    audioUrl: stream || null,
    note: "Radio stream",
    artwork: station.favicon || null,
    permalink: station.homepage || null
  };
}

async function searchAudius(query, limit = 8) {
  const json = await fetchJson(apiUrl(AUDIUS_API_BASE, "/tracks/search", {
    query,
    limit,
    sort_method: "relevant",
    app_name: APP_NAME
  }));
  return (json.data || []).map(normalizeAudius);
}

async function resolveAudius(track) {
  const json = await fetchJson(apiUrl(AUDIUS_API_BASE, `/tracks/${track.providerId}/stream`, {
    no_redirect: "true",
    app_name: APP_NAME
  }));
  const url = typeof json.data === "string" ? json.data : null;
  if (!url) throw createAppError("Audius 没有返回可播放地址。", 502, "UPSTREAM_NO_AUDIO");
  return { ...track, audioUrl: url };
}

async function searchDeezer(query, limit = 8) {
  const json = await fetchJson(apiUrl(DEEZER_API_BASE, "/search", { q: query, limit }));
  return (json.data || []).map(normalizeDeezer).filter(track => track.audioUrl);
}

async function searchItunes(query, limit = 8) {
  const json = await fetchJson(apiUrl(ITUNES_API_BASE, "/search", {
    term: query,
    media: "music",
    entity: "song",
    limit,
    country: "US"
  }));
  return (json.results || []).map(normalizeItunes).filter(track => track.audioUrl);
}

async function searchRadio(query, limit = 8) {
  const cleaned = query.replace(/\bradio\b/gi, "").replace(/电台|广播|fm/gi, "").trim() || query;
  const json = await fetchJson(apiUrl(RADIO_BROWSER_BASE, "/json/stations/search", {
    name: cleaned,
    tag: cleaned,
    limit,
    order: "votes",
    reverse: "true",
    hidebroken: "true"
  }));
  return (Array.isArray(json) ? json : []).map(normalizeRadio).filter(track => track.audioUrl);
}

function detectMood(text) {
  const value = String(text || "").toLowerCase();
  if (/开心|兴奋|快乐|愉快|happy|party|high/.test(value)) return "happy";
  if (/放松|轻松|舒缓|治愈|relax|chill/.test(value)) return "relaxed";
  if (/专注|工作|学习|写代码|coding|focus|study/.test(value)) return "focus";
  if (/难过|伤心|emo|sad|孤独|累/.test(value)) return "sad";
  if (/深夜|晚安|睡前|night|sleep/.test(value)) return "night";
  if (/华语|中文|国语|周杰伦|五月天|陈奕迅|王菲|孙燕姿|mandopop|c-pop/.test(value)) return "chinese";
  return "daily";
}

function wantsRadio(text) {
  return /电台|广播|\bradio\b|\bfm\b/i.test(String(text || ""));
}

function wantsElectronic(text) {
  return /电子|电音|\bedm\b|\belectronic\b|\btechno\b|\btrance\b|\bdubstep\b|\bhouse\b/i.test(String(text || ""));
}

function looksElectronic(track) {
  const value = [track?.title, track?.artist, track?.album, track?.note, track?.genre]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /electronic|edm|techno|trance|dubstep|\bhouse\b|电音|电子/.test(value);
}

function cleanSearchQuery(value) {
  return String(value || "")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function normalizedSearchQueries(values, count = 5) {
  const unique = [];
  (values || []).forEach(value => {
    const query = cleanSearchQuery(value);
    if (query && !unique.some(item => item.toLowerCase() === query.toLowerCase())) unique.push(query);
  });
  return unique.slice(0, count);
}

function extractMusicQuery(text) {
  let q = String(text || "").trim();
  const intent = /(播放|放一首|点歌|来一首|听一个|听歌|搜歌|搜索|找一首|找首|想听|play|search)/i.test(q);
  if (!intent) return "";
  q = q
    .replace(/^(请|麻烦|帮我|给我|我要|我想听|想听|能不能|可以)?/u, "")
    .replace(/(音乐软件|音乐API|音乐接口|播放器|音乐平台)/g, "")
    .replace(/(播放|放一首|点歌|来一首|听一个|听歌|搜歌|搜索|找一首|找首|音乐|歌曲|歌单|歌)/g, "")
    .replace(/[，。！？、,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(开心|放松|轻松|专注|工作|学习|写代码|难过|深夜|华语|中文|国语|随便|都行)?$/.test(q)) return "";
  return q;
}

function isMusicRequest(text) {
  return /(播放|放一首|点歌|来一首|听一个|听歌|搜歌|搜索|找一首|找首|推荐|来点|换个心情|音乐|歌曲|歌手|歌单|想听|play|recommend|music)/i.test(String(text || ""));
}

function mergeUnique(existing, additions, limit = PREFERENCE_LIMIT) {
  return stringList([...(existing || []), ...(additions || [])], limit);
}

function inferGenreFromTrack(track) {
  const text = [track?.genre, track?.note, track?.album, track?.source].filter(Boolean).join(" ").toLowerCase();
  if (/jazz|jazzhop/.test(text)) return "jazzhop";
  if (/lofi|study/.test(text)) return "lofi";
  if (/indie/.test(text)) return "indie pop";
  if (/acoustic/.test(text)) return "acoustic";
  if (/piano/.test(text)) return "piano";
  if (/mandopop|c-pop|chinese/.test(text)) return "mandopop";
  return "";
}

function setFavorite(track, explicitFavorite) {
  const snapshot = sanitizeTrackSnapshot(withRuntime(track));
  if (!snapshot) throw new Error("track is required");
  const currentlyFavorite = isFavorite(snapshot.id);
  const shouldFavorite = typeof explicitFavorite === "boolean" ? explicitFavorite : !currentlyFavorite;
  userProfile.favorites = userProfile.favorites.filter(item => item.id !== snapshot.id);

  if (shouldFavorite) {
    const favorite = { ...snapshot, addedAt: new Date().toISOString() };
    userProfile.favorites.unshift(favorite);
    userProfile.favorites = userProfile.favorites.slice(0, FAVORITE_LIMIT);
    const genre = inferGenreFromTrack(snapshot);
    userProfile.preferences.artists = mergeUnique(userProfile.preferences.artists, [snapshot.artist]);
    if (genre) userProfile.preferences.genres = mergeUnique(userProfile.preferences.genres, [genre]);
  }

  saveProfile();
  return { favorite: shouldFavorite, track: snapshot };
}

function addHistory(track, context = "play") {
  const snapshot = sanitizeTrackSnapshot(withRuntime(track));
  if (!snapshot) return null;
  const played = { ...snapshot, playedAt: new Date().toISOString(), context };
  userProfile.history = userProfile.history.filter(item => item.id !== played.id);
  userProfile.history.unshift(played);
  userProfile.history = userProfile.history.slice(0, HISTORY_LIMIT);
  const genre = inferGenreFromTrack(played);
  userProfile.preferences.artists = mergeUnique(userProfile.preferences.artists, [played.artist]);
  if (genre) userProfile.preferences.genres = mergeUnique(userProfile.preferences.genres, [genre]);
  saveProfile();
  return played;
}

function updateSettings(settings = {}) {
  const next = { ...userProfile.settings };
  if (settings.theme === "light" || settings.theme === "dark") next.theme = settings.theme;
  if (typeof settings.volume === "number") next.volume = Math.max(0, Math.min(1, settings.volume));
  if (typeof settings.repeatMode === "number") next.repeatMode = Math.max(0, Math.min(2, Math.round(settings.repeatMode)));
  if (settings.lastPrompt !== undefined) next.lastPrompt = String(settings.lastPrompt || "").slice(0, 160);
  if (settings.lastScene !== undefined) next.lastScene = String(settings.lastScene || "").slice(0, 80);
  userProfile.settings = next;
  state.volume = next.volume;
  saveProfile();
  return next;
}

function updatePreferences(body = {}) {
  const input = body.preferences || body;
  userProfile.preferences = {
    artists: input.replace === true ? stringList(input.artists) : mergeUnique(userProfile.preferences.artists, stringList(input.artists)),
    genres: input.replace === true ? stringList(input.genres) : mergeUnique(userProfile.preferences.genres, stringList(input.genres)),
    scenes: input.replace === true ? stringList(input.scenes) : mergeUnique(userProfile.preferences.scenes, stringList(input.scenes)),
    avoid: input.replace === true ? stringList(input.avoid) : mergeUnique(userProfile.preferences.avoid, stringList(input.avoid))
  };
  saveProfile();
  return userProfile.preferences;
}

function preferenceQueries(text, count = 5) {
  const explicit = extractMusicQuery(text);
  if (explicit) return normalizedSearchQueries([explicit], count);

  const mood = detectMood(text);
  const seeds = recommendationSeeds[mood] || recommendationSeeds.daily;
  const artists = userProfile.preferences.artists.slice(0, 4);
  const genres = userProfile.preferences.genres.slice(0, 4);
  const favoriteArtists = userProfile.favorites.map(track => track.artist).filter(Boolean).slice(0, 4);
  const historyArtists = userProfile.history.map(track => track.artist).filter(Boolean).slice(0, 4);
  const style = genres[0] || seeds[0];
  const values = [];

  artists.forEach(artist => values.push(`${artist} ${style}`));
  favoriteArtists.forEach(artist => values.push(`${artist} songs`));
  genres.forEach(genre => values.push(`${genre} ${seeds[0]}`));
  historyArtists.forEach(artist => values.push(`${artist} ${seeds[1] || "music"}`));
  values.push(...seeds);

  return normalizedSearchQueries(values, count);
}

function recommendationQueries(text, count = 5) {
  return preferenceQueries(text, count);
}

function localMusicIntent(text) {
  const query = extractMusicQuery(text);
  if (query) {
    return {
      source: "local",
      intent: "play",
      query,
      queries: [query],
      allowRadio: wantsRadio(text),
      avoidElectronic: !wantsElectronic(text),
      reply: ""
    };
  }

  if (isMusicRequest(text)) {
    return {
      source: "local",
      intent: "recommend",
      query: "",
      queries: recommendationQueries(text, 5),
      allowRadio: wantsRadio(text),
      avoidElectronic: !wantsElectronic(text),
      reply: ""
    };
  }

  return {
    source: "local",
    intent: "chat",
    query: "",
    queries: [],
    allowRadio: false,
    avoidElectronic: true,
    reply: "我可以按心情、场景和你的收藏推荐音乐，也可以直接点歌。"
  };
}

function profileSummary() {
  const favorites = userProfile.favorites.slice(0, 6).map(track => `${track.title} - ${track.artist}`);
  const history = userProfile.history.slice(0, 6).map(track => `${track.title} - ${track.artist}`);
  const preferences = userProfile.preferences;
  return [
    `Favorite tracks: ${favorites.length ? favorites.join("; ") : "none"}`,
    `Recent plays: ${history.length ? history.join("; ") : "none"}`,
    `Preferred artists: ${preferences.artists.slice(0, 8).join(", ") || "none"}`,
    `Preferred genres: ${preferences.genres.slice(0, 8).join(", ") || "none"}`,
    `Preferred scenes: ${preferences.scenes.slice(0, 8).join(", ") || "none"}`,
    `Avoid styles: ${preferences.avoid.slice(0, 8).join(", ") || "electronic unless explicitly requested"}`,
    `Last prompt: ${userProfile.settings.lastPrompt || "none"}`
  ].join("\n");
}

function parseJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function sanitizeAiIntent(parsed, text, fallback) {
  const allowed = new Set(["play", "recommend", "chat"]);
  const intent = allowed.has(parsed?.intent) ? parsed.intent : fallback.intent;
  const query = cleanSearchQuery(parsed?.query) || fallback.query;
  const aiQueries = normalizedSearchQueries(Array.isArray(parsed?.queries) ? parsed.queries : [], 5);
  const profiled = preferenceQueries(text, 5);
  return {
    source: "deepseek",
    intent: intent === "play" && !query ? "recommend" : intent,
    query,
    queries: normalizedSearchQueries([...aiQueries, ...profiled, ...fallback.queries], 5),
    allowRadio: Boolean(parsed?.allowRadio) && wantsRadio(text),
    avoidElectronic: wantsElectronic(text) ? false : parsed?.avoidElectronic !== false,
    reply: typeof parsed?.reply === "string" ? parsed.reply.slice(0, 160).trim() : fallback.reply
  };
}

async function analyzeMusicIntent(text) {
  const fallback = localMusicIntent(text);
  if (!deepSeekEnabled()) {
    state.lastAi = { provider: "DeepSeek", source: "local", enabled: false };
    return fallback;
  }

  const systemPrompt = [
    "You are Claudio's low-cost music recommendation intent parser.",
    "Return only valid json. No markdown. No extra text.",
    'JSON schema: {"intent":"play|recommend|chat","query":"string","queries":["string"],"allowRadio":false,"avoidElectronic":true,"reply":"short Chinese string"}',
    "User profile summary:",
    profileSummary(),
    "Rules:",
    "- Use play when the user asks to play a specific song, artist, album, or style now.",
    "- Use recommend when the user asks for music recommendations, a mood, scene, vibe, or several songs.",
    "- Blend the current request with the user's favorite artists, favorite styles, and recent plays.",
    "- Keep search queries short. Prefer searchable artist/title/style words.",
    "- For Chinese music, use ASCII-friendly queries such as mandopop, c-pop, chinese pop, Jay Chou, Mayday, Eason Chan, Faye Wong.",
    "- allowRadio must be true only if the user explicitly asks for radio, broadcast, FM, or an internet station.",
    "- avoidElectronic should stay true unless the user explicitly asks for electronic, EDM, techno, house, or similar styles.",
    "- reply must be concise Simplified Chinese."
  ].join("\n");

  try {
    const json = await postJson(`${deepSeekConfig.apiBase}/chat/completions`, {
      model: deepSeekConfig.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Parse this music request as json: ${text}` }
      ],
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      max_tokens: DEEPSEEK_MAX_TOKENS,
      temperature: 0.25
    }, {
      Authorization: `Bearer ${deepSeekConfig.apiKey}`
    }, DEEPSEEK_TIMEOUT_MS);

    const content = json.choices?.[0]?.message?.content || "";
    const parsed = parseJsonObject(content);
    if (!parsed) throw new Error("DeepSeek returned empty JSON");
    const intent = sanitizeAiIntent(parsed, text, fallback);
    state.lastAi = { provider: "DeepSeek", source: "deepseek", enabled: true, model: deepSeekConfig.model };
    return intent;
  } catch (error) {
    state.lastAi = {
      provider: "DeepSeek",
      source: "local",
      enabled: true,
      model: deepSeekConfig.model,
      error: error.message
    };
    return fallback;
  }
}

function musicCandidates(tracks, query, options = {}) {
  const avoid = new Set(userProfile.preferences.avoid.map(item => item.toLowerCase()));
  let result = tracks;
  if (options.avoidElectronic !== false && !wantsElectronic(query)) result = result.filter(track => !looksElectronic(track));
  if (avoid.size) {
    result = result.filter(track => {
      const haystack = [track.title, track.artist, track.album, track.note, track.genre].filter(Boolean).join(" ").toLowerCase();
      return ![...avoid].some(term => term && haystack.includes(term));
    });
  }
  return result;
}

function sourceFailure(name, error) {
  return {
    source: name,
    code: error?.code || "SOURCE_ERROR",
    message: publicErrorMessage(error)
  };
}

function noPlayableMusicError(query, failures) {
  const sources = failures.map(item => item.source).filter(Boolean).join("、") || "真实音乐源";
  return createAppError(
    `没有找到可播放的真实音乐。可以换一个歌名、歌手或风格，或者把自己的音频文件放进 music 文件夹后再试。`,
    502,
    "NO_PLAYABLE_MUSIC",
    { query, sources, failures }
  );
}

const searchCache = new Map();

function normalizeQuery(query) {
  return String(query || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function cacheKeyForSearch(query, options = {}) {
  return JSON.stringify({
    query: normalizeQuery(query),
    preferLocal: Boolean(options.preferLocal),
    allowRadio: Boolean(options.allowRadio),
    avoidLive: Boolean(options.avoidLive),
    avoidElectronic: Boolean(options.avoidElectronic)
  });
}

function getSearchCache(key) {
  const cached = searchCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.at > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return cached.value;
}

function setSearchCache(key, value) {
  searchCache.set(key, { at: Date.now(), value });
  if (searchCache.size > SEARCH_CACHE_LIMIT) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
}

async function runLimited(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runner() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

async function playableFromQuery(query, options = {}) {
  const cacheKey = cacheKeyForSearch(query, options);
  const cached = getSearchCache(cacheKey);
  if (cached) return cached;
  const failures = [];

  const searchTasks = [
    { name: "Audius", fn: async () => {
      const audius = musicCandidates(await searchAudius(query, 8), query, options);
      for (const track of audius.slice(0, 5)) {
        try { return await resolveAudius(track); } catch (e) { failures.push(sourceFailure("Audius", e)); }
      }
      if (!audius.length) failures.push(sourceFailure("Audius", createAppError("Audius 没有匹配结果。", 502, "UPSTREAM_EMPTY")));
      throw createAppError("Audius 无可播放结果", 502, "UPSTREAM_EMPTY");
    }},
    { name: "Deezer", fn: async () => {
      const deezer = musicCandidates(await searchDeezer(query, 8), query, options);
      if (deezer.length) return deezer[0];
      failures.push(sourceFailure("Deezer", createAppError("Deezer 没有可播放预览。", 502, "UPSTREAM_EMPTY")));
      throw createAppError("Deezer 无可播放结果", 502, "UPSTREAM_EMPTY");
    }},
    { name: "iTunes", fn: async () => {
      const previews = musicCandidates(await searchItunes(query, 8), query, options);
      if (previews.length) return previews[0];
      failures.push(sourceFailure("iTunes", createAppError("iTunes 没有可播放预览。", 502, "UPSTREAM_EMPTY")));
      throw createAppError("iTunes 无可播放结果", 502, "UPSTREAM_EMPTY");
    }}
  ];

  const results = await Promise.allSettled(searchTasks.map(t => t.fn()));
  for (const r of results) {
    if (r.status === "fulfilled") {
      setSearchCache(cacheKey, r.value);
      return r.value;
    }
  }

  if (options.allowRadio) {
    try {
      const radios = await searchRadio(query, 8);
      if (radios.length) {
        setSearchCache(cacheKey, radios[0]);
        return radios[0];
      }
      failures.push(sourceFailure("Radio Browser", createAppError("Radio Browser 没有可播放电台。", 502, "UPSTREAM_EMPTY")));
    } catch (error) {
      failures.push(sourceFailure("Radio Browser", error));
    }
  }

  throw noPlayableMusicError(query, failures);
}

function addToQueue(track, playNow = true, context = "queue") {
  state.hideLocalTracks = false;
  const runtime = withRuntime(track);
  const existing = state.dynamicTracks.findIndex(item => item.id === runtime.id);
  if (existing >= 0) state.dynamicTracks[existing] = runtime;
  else state.dynamicTracks.unshift(runtime);
  if (state.dynamicTracks.length > DYNAMIC_TRACKS_LIMIT) {
    const currentId = currentTrack()?.id;
    state.dynamicTracks = state.dynamicTracks.slice(0, DYNAMIC_TRACKS_LIMIT);
    if (state.shuffledIndices) state.shuffledIndices = null;
    const list = allTracks();
    const idx = list.findIndex(item => item.id === currentId);
    state.trackIndex = idx >= 0 ? idx : Math.min(state.trackIndex, Math.max(0, list.length - 1));
  }
  if (playNow) {
    state.trackIndex = existing >= 0 ? existing : 0;
    state.startedAt = Date.now();
    state.playing = true;
    addHistory(runtime, context);
  }
  return runtime;
}

async function playMusic(query, options = {}) {
  const track = await playableFromQuery(query, options);
  return addToQueue(track, true, `play: ${query}`);
}

async function recommendMusic(text, options = {}) {
  const baseQueries = options.queries?.length ? options.queries : [];
  const queries = normalizedSearchQueries([...baseQueries, ...recommendationQueries(text, 5)], 5);
  const tracks = [];
  const failures = [];

  userProfile.settings.lastPrompt = String(text || "").slice(0, 160);
  userProfile.settings.lastScene = detectMood(text);
  updatePreferences({ scenes: [detectMood(text)] });

  state.shuffledIndices = null;

  const searchOptions = {
    allowRadio: options.allowRadio ?? wantsRadio(text),
    avoidElectronic: options.avoidElectronic ?? !wantsElectronic(text)
  };

  const results = await runLimited(queries, RECOMMENDATION_CONCURRENCY, async query => {
    try {
      const track = await playableFromQuery(query, searchOptions);
      return { status: "fulfilled", value: { track, query } };
    } catch (error) {
      return { status: "rejected", reason: error };
    }
  });

  const seenIds = new Set();
  for (const result of results) {
    if (result.status === "fulfilled") {
      const { track, query } = result.value;
      if (!seenIds.has(track.id)) {
        seenIds.add(track.id);
        tracks.push(addToQueue(track, false, `recommend: ${text}`));
      }
    } else {
      const query = queries[results.indexOf(result)] || "";
      const error = result.reason;
      failures.push({
        query,
        code: error?.code || "NO_PLAYABLE_MUSIC",
        message: publicErrorMessage(error),
        details: error?.details
      });
    }
  }

  if (!tracks.length) {
    throw createAppError(
      "没有找到可播放的真实音乐。可以换一个更具体的歌手、歌名或风格，或者把自己的音频文件放进 music 文件夹后再试。",
      502,
      "NO_PLAYABLE_MUSIC",
      { queries, failures }
    );
  }

  state.hideLocalTracks = false;
  state.trackIndex = 0;
  state.startedAt = Date.now();
  state.playing = true;
  addHistory(tracks[0], `recommend: ${text}`);
  return tracks;
}

function stamp() {
  return new Date().toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
}

function defineRoutePolicy(methods, options = {}) {
  return {
    methods,
    publicCors: false,
    sameOriginGet: false,
    stateChangingGet: false,
    ...options
  };
}

const ROUTE_POLICIES = new Map([
  ["/api/health", defineRoutePolicy(["GET", "HEAD"], { publicCors: true })],
  ["/api/user/profile", defineRoutePolicy(["GET", "HEAD", "POST"], { sameOriginGet: true })],
  ["/api/user/profile/backups", defineRoutePolicy(["GET", "HEAD"], { sameOriginGet: true })],
  ["/api/user/profile/restore", defineRoutePolicy(["POST"])],
  ["/api/user/favorite", defineRoutePolicy(["POST"])],
  ["/api/user/history", defineRoutePolicy(["POST"])],
  ["/api/user/preferences", defineRoutePolicy(["POST"])],
  ["/api/user/settings", defineRoutePolicy(["POST"])],
  ["/api/ai/status", defineRoutePolicy(["GET", "HEAD"])],
  ["/api/ai/config", defineRoutePolicy(["POST"])],
  ["/api/ai/clear", defineRoutePolicy(["POST"])],
  ["/api/now", defineRoutePolicy(["GET", "HEAD"])],
  ["/api/now-lite", defineRoutePolicy(["GET", "HEAD"])],
  ["/api/next", defineRoutePolicy(["GET", "POST"], { stateChangingGet: true })],
  ["/api/previous", defineRoutePolicy(["GET", "POST"], { stateChangingGet: true })],
  ["/api/play", defineRoutePolicy(["POST"])],
  ["/api/queue/shuffle", defineRoutePolicy(["POST"])],
  ["/api/queue/remove", defineRoutePolicy(["POST"])],
  ["/api/queue/clear", defineRoutePolicy(["POST"])],
  ["/api/queue/restore", defineRoutePolicy(["POST"])],
  ["/api/library/refresh", defineRoutePolicy(["POST"])],
  ["/api/music/search", defineRoutePolicy(["GET"])],
  ["/api/music/play", defineRoutePolicy(["POST"])],
  ["/api/music/recommend", defineRoutePolicy(["POST"])],
  ["/api/chat", defineRoutePolicy(["POST"])],
  ["/api/stream", defineRoutePolicy(["GET"])]
]);

function routePolicy(pathname) {
  return ROUTE_POLICIES.get(pathname) || null;
}

function routeMethods(policy) {
  return policy?.methods || [];
}

function sendApiMethodNotAllowed(res, methods) {
  return sendError(
    res,
    405,
    createAppError("这个 API 不支持当前请求方法。", 405, "METHOD_NOT_ALLOWED"),
    {},
    { Allow: apiAllowHeader(methods) }
  );
}

function apiAllowHeader(methods) {
  return Array.from(new Set([...(methods || []), "OPTIONS"])).join(", ");
}

function applyApiCorsHeaders(res, policy) {
  const methods = routeMethods(policy);
  if (policy?.publicCors) res.setHeader("Access-Control-Allow-Origin", "*");
  if (methods.length) res.setHeader("Access-Control-Allow-Methods", methods.join(", "));
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Claudio-Token");
}

function sendApiPreflight(res, policy) {
  const methods = routeMethods(policy);
  applyApiCorsHeaders(res, policy);
  res.writeHead(204, {
    Allow: apiAllowHeader(methods)
  });
  res.end();
}

function isLegacyNavigationGet(req, url) {
  return req.method === "GET" && url.searchParams.get("legacy") === "1";
}

function resolveProfileBackupPath(backupPath) {
  const raw = String(backupPath || "").replace(/\\/g, "/");
  const name = raw.slice("user/backups/".length);
  if (!raw.startsWith("user/backups/") || !PROFILE_BACKUP_NAME_RE.test(name)) {
    throw validationError({ backupPath: "备份路径无效。" });
  }
  const resolved = path.resolve(ROOT, raw);
  const backupRoot = path.resolve(PROFILE_BACKUP_DIR);
  const relative = path.relative(backupRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw validationError({ backupPath: "备份路径无效。" });
  }
  if (!fs.existsSync(resolved)) {
    throw validationError({ backupPath: "没有找到这个备份。" });
  }
  return { raw, resolved };
}

async function handleApi(req, res, url) {
  const policy = routePolicy(url.pathname);
  const allowedMethods = routeMethods(policy);
  if (req.method === "OPTIONS") {
    if (!policy) return sendError(res, 404, createAppError("没有找到这个 API。", 404, "API_NOT_FOUND"));
    return sendApiPreflight(res, policy);
  }

  applyApiCorsHeaders(res, policy);
  const needsSameOrigin = allowedMethods.includes(req.method) && (
    !["GET", "HEAD"].includes(req.method) ||
    policy?.stateChangingGet ||
    policy?.sameOriginGet
  );
  if (needsSameOrigin) {
    requireSameOrigin(req);
  }
  const method = req.method === "HEAD" ? "GET" : req.method;
  if (method === "GET" && url.pathname === "/api/health") {
    const queue = allTracks();
    const playableQueue = queue.map(withRuntime).filter(isPlayableTrack);
    const profileStorage = profileStorageState();
    return sendJson(res, 200, {
      ok: true,
      app: APP_NAME,
      displayName: "Claudio Music",
      appVersion: APP_VERSION,
      frontendVersion: FRONTEND_VERSION,
      host: HOST,
      port: activePort,
      pid: process.pid,
      startedAt: STARTED_AT.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      queueSize: queue.length,
      playableQueueSize: playableQueue.length,
      dynamicTracks: state.dynamicTracks.length,
      localFiles: {
        directory: "music/",
        count: localFileTrackCount(),
        extensions: AUDIO_EXTENSIONS
      },
      sources: musicSourcesState(),
      storage: {
        profile: profileStorage
      },
      config: healthConfigState(),
      checks: {
        profileWritable: profileStorage.writable,
        deepSeekConfigured: deepSeekEnabled(),
        syntheticAudioDisabled: true,
        radioExplicitOnly: true
      },
      features: {
        frontendAiConfig: true,
        deepSeekRuntimeConfig: true,
        userProfile: true,
        personalizedRecommendations: true
      },
      ai: aiPublicState()
    });
  }

  if (method === "GET" && url.pathname === "/api/user/profile") {
    return sendJson(res, 200, { ok: true, profile: publicProfile() });
  }

  if (method === "GET" && url.pathname === "/api/user/profile/backups") {
    return sendJson(res, 200, { ok: true, backups: publicProfileBackups() });
  }

  if (req.method === "POST" && url.pathname === "/api/user/profile") {
    const body = await getBody(req);
    const input = body.profile || body;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw validationError({ profile: "资料文件格式不正确。" });
    }
    const backupPath = backupProfileBeforeImport();
    userProfile = normalizeProfile(input);
    state.volume = userProfile.settings.volume;
    saveProfile();
    const summary = profileImportSummary();
    const payload = publicState({ reason: "profile-import", profile: publicProfile(), summary, backupPath });
    broadcastState("now", payload);
    return sendJson(res, 200, { ok: true, profile: publicProfile(), summary, backupPath, state: payload });
  }

  if (req.method === "POST" && url.pathname === "/api/user/profile/restore") {
    const body = await getBody(req);
    const backup = resolveProfileBackupPath(body.backupPath);
    let restored;
    try {
      restored = JSON.parse(fs.readFileSync(backup.resolved, "utf8"));
    } catch {
      throw validationError({ backupPath: "备份文件已损坏，无法恢复。" });
    }
    userProfile = normalizeProfile(restored);
    state.volume = userProfile.settings.volume;
    saveProfile();
    const summary = profileImportSummary();
    const payload = publicState({ reason: "profile-restore", profile: publicProfile(), summary, backupPath: backup.raw });
    broadcastState("now", payload);
    return sendJson(res, 200, { ok: true, profile: publicProfile(), summary, backupPath: backup.raw, state: payload });
  }

  if (req.method === "POST" && url.pathname === "/api/user/favorite") {
    const body = await getBody(req);
    const result = setFavorite(body.track || currentTrack(), typeof body.favorite === "boolean" ? body.favorite : undefined);
    return sendJson(res, 200, { ok: true, ...result, profile: publicProfile(), state: publicState({ reason: "favorite" }) });
  }

  if (req.method === "POST" && url.pathname === "/api/user/history") {
    const body = await getBody(req);
    const played = addHistory(body.track || currentTrack(), body.context || "play");
    return sendJson(res, 200, { ok: true, played, profile: publicProfile() });
  }

  if (req.method === "POST" && url.pathname === "/api/user/preferences") {
    const body = await getBody(req);
    const preferences = updatePreferences(body);
    return sendJson(res, 200, { ok: true, preferences, profile: publicProfile() });
  }

  if (req.method === "POST" && url.pathname === "/api/user/settings") {
    const body = await getBody(req);
    const settings = updateSettings(body.settings || body);
    return sendJson(res, 200, { ok: true, settings, profile: publicProfile() });
  }

  if (method === "GET" && url.pathname === "/api/ai/status") {
    return sendJson(res, 200, { ok: true, ai: aiPublicState() });
  }

  if (req.method === "POST" && url.pathname === "/api/ai/config") {
    try {
      if (!isLoopbackHostOnly()) {
        if (!ADMIN_TOKEN) throw createAppError("远程暴露时管理员口令未配置，请设置 CLAUDIO_ADMIN_TOKEN。", 500, "ADMIN_TOKEN_REQUIRED");
        const token = req.headers["x-claudio-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (token !== ADMIN_TOKEN) throw createAppError("需要管理员授权。", 401, "UNAUTHORIZED");
      }
      requireAdmin(req);
      const body = await getBody(req);
      const apiKey = requireString(body.apiKey, "apiKey", { maxLength: 300, label: "DeepSeek API Key" });
      const model = optionalString(body.model, "model", { maxLength: 80, defaultValue: deepSeekConfig.model, label: "模型名称", pattern: /^[\w.:-]+$/ });
      const apiBase = normalizeHttpsBase(body.apiBase, "apiBase", deepSeekConfig.apiBase);

      deepSeekConfig.apiKey = apiKey;
      deepSeekConfig.model = model || "deepseek-v4-flash";
      deepSeekConfig.apiBase = apiBase || "https://api.deepseek.com";
      state.lastAi = { provider: "DeepSeek", source: "runtime-config", enabled: true, model: deepSeekConfig.model };

      return sendJson(res, 200, { ok: true, ai: aiPublicState() });
    } catch (error) {
      return sendError(res, error.status || 400, error);
    }
  }

  if (req.method === "POST" && url.pathname === "/api/ai/clear") {
    try {
      if (!isLoopbackHostOnly()) {
        if (!ADMIN_TOKEN) throw createAppError("远程暴露时管理员口令未配置，请设置 CLAUDIO_ADMIN_TOKEN。", 500, "ADMIN_TOKEN_REQUIRED");
        const token = req.headers["x-claudio-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (token !== ADMIN_TOKEN) throw createAppError("需要管理员授权。", 401, "UNAUTHORIZED");
      }
      requireAdmin(req);
      deepSeekConfig.apiKey = "";
      state.lastAi = { provider: "DeepSeek", source: "runtime-config", enabled: false, model: deepSeekConfig.model };
      return sendJson(res, 200, { ok: true, ai: aiPublicState() });
    } catch (error) {
      return sendError(res, error.status || 401, error, { ai: aiPublicState() });
    }
  }

  if (method === "GET" && url.pathname === "/api/now") return sendJson(res, 200, publicState());

  if (method === "GET" && url.pathname === "/api/now-lite") return sendJson(res, 200, publicNowState());

  function moveTrack(delta, reason) {
    const list = allTracks();
    state.trackIndex = list.length ? (state.trackIndex + delta + list.length) % list.length : 0;
    state.startedAt = Date.now();
    const now = currentTrack();
    if (state.playing && now) addHistory(now, reason);
    return sendState(res, { reason });
  }

  if ((req.method === "POST" || isLegacyNavigationGet(req, url)) && url.pathname === "/api/next") {
    return moveTrack(1, "next");
  }

  if ((req.method === "POST" || isLegacyNavigationGet(req, url)) && url.pathname === "/api/previous") {
    return moveTrack(-1, "previous");
  }

  if (req.method === "GET" && policy?.stateChangingGet) {
    return sendApiMethodNotAllowed(res, allowedMethods);
  }

  if (req.method === "POST" && url.pathname === "/api/play") {
    try {
      const body = await getBody(req);
      const list = allTracks();
      if (body.track?.id) {
        const playing = optionalBoolean(body.playing, "playing", true);
        const context = optionalString(body.context, "context", { maxLength: 120, defaultValue: "saved-track", label: "播放上下文" });
        const track = addToQueue(body.track, playing !== false, context);
        return sendJson(res, 200, publicState({ reason: "play-track", musicTrack: track }));
      }
      const index = optionalNumber(body.index, "index", { integer: true, min: 0, max: Math.max(0, list.length - 1), label: "队列索引" });
      if (index !== undefined && list.length) {
        state.trackIndex = index;
        state.startedAt = Date.now();
      }
      const playing = optionalBoolean(body.playing, "playing");
      if (playing !== undefined) state.playing = playing;
      const volume = optionalNumber(body.volume, "volume", { min: 0, max: 1, label: "音量" });
      if (volume !== undefined) updateSettings({ volume });
      const now = currentTrack();
      if (state.playing && now) addHistory(now, "play");
      return sendJson(res, 200, publicState({ reason: "play" }));
    } catch (error) {
      return sendError(res, error.status || 400, error);
    }
  }

  if (req.method === "POST" && url.pathname === "/api/queue/shuffle") {
    try {
      const body = await getBody(req);
      const shuffle = optionalBoolean(body.shuffle, "shuffle", false);
      if (shuffle) {
        const list = state.dynamicTracks;
        const n = list.length;
        const indices = Array.from({ length: n }, (_, i) => i);
        for (let i = n - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        state.shuffledIndices = indices;
      } else {
        state.shuffledIndices = null;
      }
      return sendJson(res, 200, publicState({ reason: "shuffle", shuffled: shuffle }));
    } catch (error) {
      return sendError(res, error.status || 400, error);
    }
  }

  if (req.method === "POST" && url.pathname === "/api/queue/remove") {
    try {
      const body = await getBody(req);
      const list = state.dynamicTracks;
      let removedIndex = -1;
      const trackId = optionalString(body.trackId, "trackId", { maxLength: 160, label: "歌曲 ID" });

      if (trackId) {
        removedIndex = list.findIndex(track => track.id === trackId);
        if (removedIndex < 0) return sendError(res, 400, createAppError("没有在动态队列中找到这首歌曲。", 400, "TRACK_NOT_FOUND"));
      } else {
        if (body.index == null) throw validationError({ index: "请提供要移除的队列索引或歌曲 ID。" });
        const index = requireNumber(body.index, "index", { integer: true, min: 0, max: Math.max(0, list.length - 1), label: "队列索引" });
        if (index >= list.length) return sendError(res, 400, createAppError("队列索引超出范围。", 400, "INDEX_OUT_OF_RANGE"));
        removedIndex = index;
      }

      list.splice(removedIndex, 1);
      state.shuffledIndices = null;
      if (removedIndex < state.trackIndex) state.trackIndex -= 1;
      state.trackIndex = Math.min(state.trackIndex, Math.max(0, allTracks().length - 1));
      return sendJson(res, 200, publicState({ reason: "remove", removedIndex }));
    } catch (error) {
      return sendError(res, error.status || 400, error);
    }
  }

  if (req.method === "POST" && url.pathname === "/api/queue/clear") {
    state.dynamicTracks = [];
    state.hideLocalTracks = true;
    state.shuffledIndices = null;
    state.trackIndex = 0;
    state.playing = false;
    state.startedAt = Date.now();
    return sendJson(res, 200, publicState({ reason: "clear" }));
  }

  if (req.method === "POST" && url.pathname === "/api/queue/restore") {
    try {
      const body = await getBody(req);
      const tracks = Array.isArray(body.tracks) ? body.tracks : [];
      if (!tracks.length) throw validationError({ tracks: "请提供要恢复的队列。" });

      const restored = tracks
        .map(track => sanitizeTrackSnapshot(track))
        .filter(Boolean)
        .slice(0, 200);
      if (!restored.length) throw validationError({ tracks: "没有可恢复的歌曲。" });

      state.dynamicTracks = restored
        .filter(track => track.source !== "local")
        .map(track => withRuntime(track))
        .filter(Boolean);
      state.hideLocalTracks = false;
      state.shuffledIndices = null;
      state.trackIndex = 0;
      state.playing = false;
      state.startedAt = Date.now();
      return sendJson(res, 200, publicState({ reason: "restore", restored: restored.length }));
    } catch (error) {
      return sendError(res, error.status || 400, error);
    }
  }

  if (req.method === "POST" && url.pathname === "/api/library/refresh") {
    const library = refreshMusicLibrary();
    return sendState(res, { reason: "library-refresh", library });
  }

  if (req.method === "GET" && url.pathname === "/api/music/search") {
    try {
      const q = optionalString(url.searchParams.get("q"), "q", { maxLength: 200, defaultValue: "recommend music", label: "搜索关键词" });
      const intent = await analyzeMusicIntent(q);
      const queries = intent.queries.length ? intent.queries : recommendationQueries(q, 3);
      const results = await Promise.allSettled(queries.map(query =>
        playableFromQuery(query, {
          allowRadio: intent.allowRadio,
          avoidElectronic: intent.avoidElectronic
        })
      ));
      const tracks = [];
      const failures = [];
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === "fulfilled") {
          tracks.push(results[i].value);
        } else {
          failures.push({ query: queries[i], code: results[i].reason?.code || "NO_PLAYABLE_MUSIC" });
        }
      }
      return sendJson(res, 200, { ok: true, tracks: tracks.map(withRuntime), failures, ai: aiPublicState(), profile: publicProfile() });
    } catch (error) {
      return sendError(res, error.status || 502, error, { ai: aiPublicState() });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/music/play") {
    try {
      const body = await getBody(req);
      const query = requireString(body.keyword ?? body.query, "query", { maxLength: 200, label: "播放关键词" });
      const intent = await analyzeMusicIntent(`播放 ${query}`);
      const track = await playMusic(intent.query || query, {
        allowRadio: intent.allowRadio,
        avoidElectronic: intent.avoidElectronic
      });
      return sendState(res, { reason: "music-play", musicTrack: track });
    } catch (error) {
      return sendError(res, error.status || 502, error, { ai: aiPublicState() });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/music/recommend") {
    try {
      const body = await getBody(req);
      const text = optionalString(body.mood ?? body.message, "message", { maxLength: 200, defaultValue: "recommend music", label: "推荐描述" });
      const intent = await analyzeMusicIntent(text);
      const tracks = await recommendMusic(text, intent);
      return sendJson(res, 200, publicState({ reason: "recommend", recommended: tracks }));
    } catch (error) {
      return sendError(res, error.status || 502, error, { ai: aiPublicState() });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await getBody(req);
    let text;
    try {
      text = requireString(body.message, "message", { maxLength: 200, label: "消息内容" });
    } catch (error) {
      return sendError(res, error.status || 400, error);
    }

    const at = stamp();
    state.messages.push({ role: "user", at, text });

    let reply;
    try {
      const intent = await analyzeMusicIntent(text);
      if (intent.intent === "chat") {
        reply = intent.reply || "我可以按心情、场景和你的收藏推荐音乐，也可以直接点歌。";
        state.playing = false;
      } else if (intent.intent === "play" && (intent.query || intent.queries[0])) {
        const query = intent.query || intent.queries[0];
        const track = await playMusic(query, {
          allowRadio: intent.allowRadio,
          avoidElectronic: intent.avoidElectronic
        });
        reply = `正在播放：${track.title} - ${track.artist}`;
      } else {
        const tracks = await recommendMusic(text, intent);
        reply = `我按你的偏好排了 ${tracks.length} 首：\n\n${tracks
          .map((track, index) => `${index + 1}. ${track.title} - ${track.artist}`)
          .join("\n")}`;
      }
    } catch (error) {
      reply = publicErrorMessage(error);
      state.playing = false;
    }

    state.messages.push({ role: "ai", at, text: reply });
    if (state.messages.length > MAX_MESSAGES) state.messages = state.messages.slice(-MAX_MESSAGES);
    return sendState(res, { reply });
  }

  if (req.method === "GET" && url.pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    sseClients.add(res);
    ensureSseHeartbeat();
    writeSse(res, "now", publicState({ reason: "connect" }));
    req.on("close", () => {
      sseClients.delete(res);
      stopSseHeartbeatIfIdle();
    });
    return;
  }

  if (policy && !allowedMethods.includes(req.method)) {
    return sendApiMethodNotAllowed(res, allowedMethods);
  }

  sendError(res, 404, createAppError("没有找到这个 API。", 404, "API_NOT_FOUND"));
}

function logRequest(requestId, method, pathname, status, ms) {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const statusColor = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";
  console.log(`\x1b[2m${time}\x1b[0m ${statusColor}${status}\x1b[0m ${method} ${pathname} \x1b[2m${ms}ms\x1b[0m \x1b[2m#${requestId}\x1b[0m`);
}

function applySecurityHeaders(res) {
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => {
    if (!res.hasHeader(name)) res.setHeader(name, value);
  });
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw createAppError("URL 编码无效。", 400, "INVALID_URL_ENCODING");
  }
}

function isPathInsideRoot(resolved, root) {
  const target = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const boundary = process.platform === "win32" ? root.toLowerCase() : root;
  return target.startsWith(boundary + path.sep) || target === boundary;
}

function safePublicPath(urlPath) {
  const decoded = safeDecodeURIComponent(urlPath);
  const normalized = path.normalize(decoded === "/" ? "/index.html" : decoded);
  const filePath = path.join(PUBLIC_DIR, normalized);
  const resolved = path.resolve(filePath);
  const publicRoot = path.resolve(PUBLIC_DIR);
  return isPathInsideRoot(resolved, publicRoot) ? resolved : null;
}

function safeMusicPath(urlPath) {
  const decoded = safeDecodeURIComponent(urlPath.slice("/music/".length));
  const segments = decoded.split(/[\\/]/).filter(s => s && s !== "..");
  const filePath = path.join(MUSIC_DIR, ...segments);
  const resolved = path.resolve(filePath);
  const musicRoot = path.resolve(MUSIC_DIR);
  return isPathInsideRoot(resolved, musicRoot) ? resolved : null;
}

function renderVersionedAsset(text) {
  return text
    .replace(/__CLAUDIO_FRONTEND_VERSION__/g, FRONTEND_VERSION)
    .replace(/__CLAUDIO_APP_VERSION__/g, APP_VERSION);
}

function methodNotAllowed(res, allowed = "GET, HEAD") {
  return sendText(res, 405, "Method Not Allowed", "text/plain; charset=utf-8", {
    Allow: allowed
  });
}

function endHead(req, res) {
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  return false;
}

function serveVersionedText(req, res, filePath, cacheControl) {
  fs.readFile(filePath, "utf8", (error, text) => {
    if (error) return sendText(res, 404, "Not found");
    const body = renderVersionedAsset(text);
    const statVersion = fileVersion(filePath);
    const etag = `W/\"${statVersion}-${FRONTEND_VERSION}\"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag, "Cache-Control": cacheControl });
      return res.end();
    }
    if (req.method === "HEAD") {
      res.writeHead(200, {
        "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "text/plain; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        ETag: etag,
        "Cache-Control": cacheControl
      });
      return res.end();
    }
    return sendText(res, 200, body, mimeTypes[path.extname(filePath).toLowerCase()] || "text/plain; charset=utf-8", {
      ETag: etag,
      "Cache-Control": cacheControl
    });
  });
}

function serveFile(req, res, filePath, cacheControl = "public, max-age=300") {
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) return sendText(res, 404, "Not found");
    const type = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const etag = `W/\"${stat.size}-${Math.floor(stat.mtimeMs)}\"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag, "Cache-Control": cacheControl });
      return res.end();
    }
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": stat.size,
      ETag: etag,
      "Cache-Control": cacheControl
    });
    if (endHead(req, res)) return;
    fs.createReadStream(filePath).pipe(res);
  });
}

function serveAudioFile(req, res, filePath, cacheControl = "public, max-age=86400") {
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) return sendText(res, 404, "Not found");
    const type = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const etag = `W/\"${stat.size}-${Math.floor(stat.mtimeMs)}\"`;
    const range = req.headers.range;

    if (!range) {
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
        ETag: etag,
        "Cache-Control": cacheControl
      });
      if (endHead(req, res)) return;
      return fs.createReadStream(filePath).pipe(res);
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, {
        "Content-Range": `bytes */${stat.size}`,
        "Accept-Ranges": "bytes"
      });
      return res.end();
    }

    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!match[1] && match[2]) {
      const suffix = Number(match[2]);
      start = Math.max(0, stat.size - suffix);
      end = stat.size - 1;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= stat.size || start > end) {
      res.writeHead(416, {
        "Content-Range": `bytes */${stat.size}`,
        "Accept-Ranges": "bytes"
      });
      return res.end();
    }

    res.writeHead(206, {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      ETag: etag,
      "Cache-Control": cacheControl
    });
    if (endHead(req, res)) return;
    fs.createReadStream(filePath, { start, end }).pipe(res);
  });
}

function serveStatic(req, res, url) {
  if (!["GET", "HEAD"].includes(req.method)) return methodNotAllowed(res);
  const filePath = safePublicPath(url.pathname);
  if (!filePath) return sendText(res, 403, "Forbidden");
  fs.stat(filePath, error => {
    if (error) {
      if (!path.extname(filePath)) return serveVersionedText(req, res, path.join(PUBLIC_DIR, "index.html"), "no-cache");
      return sendText(res, 404, "Not found");
    }
    const fileName = path.basename(filePath);
    if (fileName === "index.html" || fileName === "service-worker.js") {
      return serveVersionedText(req, res, filePath, "no-cache");
    }
    const cacheControl = url.searchParams.get("v") === FRONTEND_VERSION
      ? VERSIONED_STATIC_CACHE
      : SHORT_STATIC_CACHE;
    serveFile(req, res, filePath, cacheControl);
  });
}

function serveMusic(req, res, url) {
  if (!["GET", "HEAD"].includes(req.method)) return methodNotAllowed(res);
  const filePath = safeMusicPath(url.pathname);
  if (!filePath) return sendText(res, 403, "Forbidden");
  serveAudioFile(req, res, filePath, "public, max-age=86400");
}

ensureDir(USER_DIR);
saveProfile();

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const requestId = crypto.randomUUID().slice(0, 8);
  let statusCode = 200;
  let logged = false;
  let pathname = "/";
  const originalEnd = res.end;
  const originalWriteHead = res.writeHead;

  res.requestId = requestId;
  res.headOnly = req.method === "HEAD";

  res.writeHead = function (code, ...args) {
    statusCode = code;
    applySecurityHeaders(this);
    return originalWriteHead.call(this, code, ...args);
  };

  res.end = function (...args) {
    if (!logged) {
      logged = true;
      logRequest(requestId, req.method, pathname, statusCode, Date.now() - started);
    }
    return originalEnd.call(this, ...args);
  };

  try {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    pathname = url.pathname;
    if (url.pathname.startsWith("/music/")) return serveMusic(req, res, url);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    serveStatic(req, res, url);
  } catch (error) {
    const status = error.status || 500;
    sendError(res, status, error, { ai: aiPublicState() });
  }
});

server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;

let activePort = PORT;
let shuttingDown = false;

server.on("error", error => {
  if (error.code === "EADDRINUSE" && activePort < PORT + 10) {
    activePort += 1;
    server.listen(activePort, HOST);
    return;
  }
  console.error(error);
  process.exit(1);
});

server.on("listening", () => {
  console.log(`Claudio Music is ready at http://127.0.0.1:${activePort}/`);
});

server.on("clientError", (error, socket) => {
  if (!socket.writable) return;
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

server.listen(activePort, HOST);

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  saveProfile();
  closeSseClients("shutdown", { ok: false, signal });
  const forceExit = setTimeout(() => process.exit(0), 2500);
  server.close(() => {
    clearTimeout(forceExit);
    process.exit(0);
  });
  server.closeIdleConnections?.();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
