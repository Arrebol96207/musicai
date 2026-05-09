const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

loadEnvFile(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const MUSIC_DIR = path.join(ROOT, "music");

const AUDIUS_API_BASE = "https://api.audius.co/v1";
const ITUNES_API_BASE = "https://itunes.apple.com";
const DEEZER_API_BASE = "https://api.deezer.com";
const RADIO_BROWSER_BASE = "https://de1.api.radio-browser.info";
const APP_NAME = "ClaudioMusic";
const APP_VERSION = "9";
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"];

const deepSeekConfig = {
  apiKey: process.env.DEEPSEEK_API_KEY || "",
  apiBase: (process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com").replace(/\/+$/, ""),
  model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"
};
const DEEPSEEK_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS || 10000);
const DEEPSEEK_MAX_TOKENS = Number(process.env.DEEPSEEK_MAX_TOKENS || 220);

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

const recommendationSeeds = {
  daily: ["lofi chill", "indie pop", "dream pop", "acoustic morning", "jazzhop"],
  happy: ["feel good indie", "upbeat pop", "funk groove", "summer indie", "city pop"],
  relaxed: ["lofi chill", "soft indie", "downtempo", "acoustic chill", "quiet piano"],
  focus: ["lofi focus", "instrumental hip hop", "jazzhop focus", "ambient piano", "study beats"],
  sad: ["sad indie", "melancholy acoustic", "dream pop", "soft piano", "rainy day music"],
  night: ["late night jazz", "night drive", "soul night", "ambient piano", "bedroom pop"],
  chinese: ["mandopop", "chinese pop", "taiwan indie", "c-pop", "chinese indie"]
};

const state = {
  startedAt: Date.now(),
  trackIndex: 0,
  playing: false,
  volume: 0.68,
  dynamicTracks: [],
  lastAi: null,
  messages: [
    {
      role: "ai",
      at: "00:00",
      text: "你好，我是 Claudio。告诉我你想听的歌、歌手、心情或风格，我会搜索真实音乐源并播放。"
    }
  ]
};

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
    mode: "cheap-json-intent",
    last: state.lastAi,
    ...extra
  };
}

function readJson(fileName, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, fileName), "utf8"));
  } catch {
    return fallback;
  }
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

function localTracks() {
  const declared = readJson("tracks.json", []);
  const declaredAudio = new Set(declared.map(track => path.basename(String(track.audioUrl || ""))).filter(Boolean));
  return declared.concat(localFileTracks().filter(track => !declaredAudio.has(path.basename(track.audioUrl))));
}

function allTracks() {
  return state.dynamicTracks.concat(localTracks());
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

function withRuntime(track) {
  if (!track) return null;
  const audioUrl = fileAudioUrl(track);
  return {
    ...track,
    audioUrl,
    audioMode: audioModeFor(track, audioUrl)
  };
}

function currentTrack() {
  const tracks = allTracks().map(withRuntime);
  return tracks[state.trackIndex] || tracks[0] || null;
}

function elapsedSeconds(track = currentTrack()) {
  if (!track || !state.playing) return 0;
  return Math.floor((Date.now() - state.startedAt) / 1000) % Math.max(1, track.duration || 180);
}

function publicState(extra = {}) {
  const queue = allTracks().map(withRuntime);
  const now = queue[state.trackIndex] || queue[0] || null;
  return {
    app: "Claudio Music",
    appVersion: APP_VERSION,
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

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
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
    if (!response.ok) throw new Error(json.error?.message || `HTTP ${response.status}`);
    return json;
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
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(json.error?.message || `HTTP ${response.status}`);
    return json;
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
  if (!url) throw new Error(`${track.title} has no Audius stream`);
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
  return /电台|广播|radio|fm\b/i.test(String(text || ""));
}

function wantsElectronic(text) {
  return /电子|电音|edm|electronic|techno|trance|dubstep|house\b/i.test(String(text || ""));
}

function looksElectronic(track) {
  const value = [
    track?.title,
    track?.artist,
    track?.album,
    track?.note,
    track?.genre
  ].filter(Boolean).join(" ").toLowerCase();
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
    if (query && !unique.includes(query)) unique.push(query);
  });
  return unique.slice(0, count);
}

function extractMusicQuery(text) {
  let q = String(text || "").trim();
  const intent = /(播放|放一首|点歌|来一首|听一下|听歌|搜歌|搜索|找一首|找首|想听)/.test(q);
  if (!intent) return "";
  q = q
    .replace(/^(请|麻烦|帮我|给我|我要|我想听|想听|能不能|可以)?/u, "")
    .replace(/(网易云|网易云音乐|QQ音乐|酷狗|酷我|Spotify|Apple Music|Audius|Deezer|音乐软件|音乐API|音乐接口)/gi, "")
    .replace(/(播放|放一首|点歌|来一首|听一下|听歌|搜歌|搜索|找一首|找首|音乐|歌曲|歌单|歌)/g, "")
    .replace(/[，。！？、,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(开心|放松|轻松|专注|工作|学习|写代码|难过|深夜|华语|中文|国语|随便|都行)?$/.test(q)) return "";
  return q;
}

function isMusicRequest(text) {
  return /(播放|放一首|点歌|来一首|听一下|听歌|搜歌|搜索|找一首|找首|推荐|来点|换个心情|音乐|歌曲|歌手|歌单|想听)/.test(String(text || ""));
}

function recommendationQueries(text, count = 5) {
  const explicit = extractMusicQuery(text);
  const mood = detectMood(text);
  const base = explicit ? [explicit] : recommendationSeeds[mood] || recommendationSeeds.daily;
  return normalizedSearchQueries(base, count);
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
    reply: "我可以帮你按心情推荐音乐，也可以直接点歌。"
  };
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
  const queries = normalizedSearchQueries(Array.isArray(parsed?.queries) ? parsed.queries : [], 5);
  return {
    source: "deepseek",
    intent: intent === "play" && !query ? "recommend" : intent,
    query,
    queries: queries.length ? queries : fallback.queries,
    allowRadio: Boolean(parsed?.allowRadio) && wantsRadio(text),
    avoidElectronic: !wantsElectronic(text),
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
    "You are Claudio's low-cost music intent parser.",
    "Return only valid json. No markdown. No extra text.",
    'JSON schema: {"intent":"play|recommend|chat","query":"string","queries":["string"],"allowRadio":false,"avoidElectronic":true,"reply":"short Chinese string"}',
    "Rules:",
    "- Use play when the user asks to play a specific song, artist, album, or style now.",
    "- Use recommend when the user asks for music recommendations, a mood, scene, vibe, or several songs.",
    "- Use chat only when the user is not asking for music.",
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
      temperature: 0.2
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
  if (options.avoidElectronic === false || wantsElectronic(query)) return tracks;
  return tracks.filter(track => !looksElectronic(track));
}

async function playableFromQuery(query, options = {}) {
  const errors = [];

  try {
    const audius = musicCandidates(await searchAudius(query, 8), query, options);
    for (const track of audius.slice(0, 5)) {
      try {
        return await resolveAudius(track);
      } catch (error) {
        errors.push(error.message);
      }
    }
  } catch (error) {
    errors.push(`Audius: ${error.message}`);
  }

  try {
    const deezer = musicCandidates(await searchDeezer(query, 8), query, options);
    if (deezer.length) return deezer[0];
  } catch (error) {
    errors.push(`Deezer: ${error.message}`);
  }

  try {
    const previews = musicCandidates(await searchItunes(query, 8), query, options);
    if (previews.length) return previews[0];
  } catch (error) {
    errors.push(`iTunes: ${error.message}`);
  }

  if (options.allowRadio) {
    try {
      const radios = await searchRadio(query, 8);
      if (radios.length) return radios[0];
    } catch (error) {
      errors.push(`Radio: ${error.message}`);
    }
  }

  throw new Error(errors.join("; ") || "No playable music found");
}

function addToQueue(track, playNow = true) {
  const runtime = withRuntime(track);
  const existing = state.dynamicTracks.findIndex(item => item.id === runtime.id);
  if (existing >= 0) state.dynamicTracks[existing] = runtime;
  else state.dynamicTracks.unshift(runtime);
  if (playNow) {
    state.trackIndex = 0;
    state.startedAt = Date.now();
    state.playing = true;
  }
  return runtime;
}

async function playMusic(query, options = {}) {
  const track = await playableFromQuery(query, options);
  return addToQueue(track, true);
}

async function recommendMusic(text, options = {}) {
  const queries = normalizedSearchQueries(options.queries?.length ? options.queries : recommendationQueries(text, 5), 5);
  const tracks = [];
  const errors = [];

  for (const query of queries) {
    try {
      const track = await playableFromQuery(query, {
        allowRadio: options.allowRadio ?? wantsRadio(text),
        avoidElectronic: options.avoidElectronic ?? !wantsElectronic(text)
      });
      if (!tracks.some(item => item.id === track.id)) tracks.push(addToQueue(track, false));
    } catch (error) {
      errors.push(`${query}: ${error.message}`);
    }
  }

  if (!tracks.length) throw new Error(errors.join("; ") || "No recommendations found");

  state.trackIndex = 0;
  state.startedAt = Date.now();
  state.playing = true;
  return tracks;
}

function stamp() {
  return new Date().toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      app: "Claudio Music",
      appVersion: APP_VERSION,
      queueSize: allTracks().length,
      dynamicTracks: state.dynamicTracks.length,
      features: {
        frontendAiConfig: true,
        deepSeekRuntimeConfig: true
      },
      ai: aiPublicState()
    });
  }

  if (req.method === "GET" && url.pathname === "/api/ai/status") {
    return sendJson(res, 200, { ok: true, ai: aiPublicState() });
  }

  if (req.method === "POST" && url.pathname === "/api/ai/config") {
    const body = await getBody(req);
    const apiKey = String(body.apiKey || "").trim();
    const model = String(body.model || deepSeekConfig.model).trim();
    const apiBase = String(body.apiBase || deepSeekConfig.apiBase).trim().replace(/\/+$/, "");

    if (!apiKey) return sendJson(res, 400, { ok: false, error: "DeepSeek API Key is required" });
    if (!apiBase.startsWith("https://")) return sendJson(res, 400, { ok: false, error: "API Base must start with https://" });

    deepSeekConfig.apiKey = apiKey;
    deepSeekConfig.model = model || "deepseek-v4-flash";
    deepSeekConfig.apiBase = apiBase || "https://api.deepseek.com";
    state.lastAi = { provider: "DeepSeek", source: "runtime-config", enabled: true, model: deepSeekConfig.model };

    return sendJson(res, 200, { ok: true, ai: aiPublicState() });
  }

  if (req.method === "POST" && url.pathname === "/api/ai/clear") {
    deepSeekConfig.apiKey = "";
    state.lastAi = { provider: "DeepSeek", source: "runtime-config", enabled: false, model: deepSeekConfig.model };
    return sendJson(res, 200, { ok: true, ai: aiPublicState() });
  }

  if (req.method === "GET" && url.pathname === "/api/now") return sendJson(res, 200, publicState());

  if (req.method === "GET" && url.pathname === "/api/next") {
    const list = allTracks();
    state.trackIndex = list.length ? (state.trackIndex + 1) % list.length : 0;
    state.startedAt = Date.now();
    return sendJson(res, 200, publicState({ reason: "next" }));
  }

  if (req.method === "GET" && url.pathname === "/api/previous") {
    const list = allTracks();
    state.trackIndex = list.length ? (state.trackIndex - 1 + list.length) % list.length : 0;
    state.startedAt = Date.now();
    return sendJson(res, 200, publicState({ reason: "previous" }));
  }

  if (req.method === "POST" && url.pathname === "/api/play") {
    const body = await getBody(req);
    const list = allTracks();
    if (Number.isInteger(body.index) && list.length) {
      state.trackIndex = Math.max(0, Math.min(list.length - 1, body.index));
      state.startedAt = Date.now();
    }
    if (typeof body.playing === "boolean") state.playing = body.playing;
    if (typeof body.volume === "number") state.volume = Math.max(0, Math.min(1, body.volume));
    return sendJson(res, 200, publicState({ reason: "play" }));
  }

  if (req.method === "GET" && url.pathname === "/api/music/search") {
    try {
      const q = url.searchParams.get("q") || "";
      const intent = await analyzeMusicIntent(q || "recommend music");
      const tracks = await Promise.all((intent.queries.length ? intent.queries : recommendationQueries(q, 3)).map(query =>
        playableFromQuery(query, {
          allowRadio: intent.allowRadio,
          avoidElectronic: intent.avoidElectronic
        })
      ));
      return sendJson(res, 200, { ok: true, tracks: tracks.map(withRuntime), ai: aiPublicState() });
    } catch (error) {
      return sendJson(res, 502, { ok: false, error: error.message, ai: aiPublicState() });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/music/play") {
    try {
      const body = await getBody(req);
      const query = String(body.keyword || body.query || "").trim();
      if (!query) return sendJson(res, 400, { ok: false, error: "query is required" });
      const intent = await analyzeMusicIntent(`播放 ${query}`);
      const track = await playMusic(intent.query || query, {
        allowRadio: intent.allowRadio,
        avoidElectronic: intent.avoidElectronic
      });
      return sendJson(res, 200, publicState({ reason: "music-play", musicTrack: track }));
    } catch (error) {
      return sendJson(res, 502, { ok: false, error: error.message, ai: aiPublicState() });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/music/recommend") {
    try {
      const body = await getBody(req);
      const text = body.mood || body.message || "recommend music";
      const intent = await analyzeMusicIntent(text);
      const tracks = await recommendMusic(text, intent);
      return sendJson(res, 200, publicState({ reason: "recommend", recommended: tracks }));
    } catch (error) {
      return sendJson(res, 502, { ok: false, error: error.message, ai: aiPublicState() });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await getBody(req);
    const text = String(body.message || "").trim();
    if (!text) return sendJson(res, 400, { error: "message is required" });

    const at = stamp();
    state.messages.push({ role: "user", at, text });

    let reply;
    try {
      const intent = await analyzeMusicIntent(text);
      if (intent.intent === "chat") {
        reply = intent.reply || "我可以帮你按心情推荐音乐，也可以直接点歌。";
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
        reply = `我给你排了 ${tracks.length} 首：\n\n${tracks
          .map((track, index) => `${index + 1}. ${track.title} - ${track.artist}`)
          .join("\n")}`;
      }
    } catch (error) {
      reply = `没拿到可播放的真实音乐源：${error.message}`;
      state.playing = false;
    }

    state.messages.push({ role: "ai", at, text: reply });
    return sendJson(res, 200, publicState({ reply }));
  }

  if (req.method === "GET" && url.pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    const send = () => res.write(`event: now\ndata: ${JSON.stringify(publicState())}\n\n`);
    send();
    const timer = setInterval(send, 3000);
    req.on("close", () => clearInterval(timer));
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

function safePublicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const normalized = path.normalize(decoded === "/" ? "/index.html" : decoded);
  const filePath = path.join(PUBLIC_DIR, normalized);
  return filePath.startsWith(PUBLIC_DIR) ? filePath : null;
}

function safeMusicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.slice("/music/".length));
  const filePath = path.resolve(MUSIC_DIR, decoded);
  const root = path.resolve(MUSIC_DIR);
  return filePath.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`) ? filePath : null;
}

function serveFile(res, filePath, cacheControl = "public, max-age=300") {
  fs.readFile(filePath, (error, content) => {
    if (error) return sendText(res, 404, "Not found");
    const type = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const etag = crypto.createHash("sha1").update(content).digest("hex");
    res.writeHead(200, {
      "Content-Type": type,
      ETag: etag,
      "Cache-Control": cacheControl
    });
    res.end(content);
  });
}

function serveStatic(res, url) {
  const filePath = safePublicPath(url.pathname);
  if (!filePath) return sendText(res, 403, "Forbidden");
  fs.stat(filePath, error => {
    if (error) {
      if (!path.extname(filePath)) return serveFile(res, path.join(PUBLIC_DIR, "index.html"), "no-cache");
      return sendText(res, 404, "Not found");
    }
    serveFile(res, filePath, filePath.endsWith("service-worker.js") ? "no-cache" : "public, max-age=300");
  });
}

function serveMusic(res, url) {
  const filePath = safeMusicPath(url.pathname);
  if (!filePath) return sendText(res, 403, "Forbidden");
  serveFile(res, filePath, "public, max-age=86400");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/music/")) return serveMusic(res, url);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    serveStatic(res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error", ai: aiPublicState() });
  }
});

let activePort = PORT;

server.on("error", error => {
  if (error.code === "EADDRINUSE" && activePort < PORT + 10) {
    activePort += 1;
    server.listen(activePort, "0.0.0.0");
    return;
  }
  console.error(error);
  process.exit(1);
});

server.on("listening", () => {
  console.log(`Claudio Music is ready at http://127.0.0.1:${activePort}/?v=9`);
});

server.listen(activePort, "0.0.0.0");
