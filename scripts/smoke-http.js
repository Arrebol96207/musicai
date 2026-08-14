const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const profilePath = path.join(root, "user", "profile.json");
const backupDir = path.join(root, "user", "backups");
const musicDir = path.join(root, "music");
const port = 3900 + Math.floor(Math.random() * 1000);
const env = {
  ...process.env,
  PORT: String(port),
  CLAUDIO_SKIP_ENV: "1",
  CLAUDIO_ADMIN_TOKEN: "smoke-token",
  DEEPSEEK_TIMEOUT_MS: "not-a-number",
  DEEPSEEK_MAX_TOKENS: "-10",
  CLAUDIO_REQUEST_TIMEOUT_MS: "invalid",
  CLAUDIO_HEADERS_TIMEOUT_MS: "invalid",
  CLAUDIO_KEEP_ALIVE_TIMEOUT_MS: "invalid"
};

const child = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
let stopped = false;
let originalProfile = null;
let hadOriginalProfile = false;
let originalBackups = [];
let hadBackupDir = false;
let smokeLibraryFilePath = "";
const failures = [];

child.stdout.on("data", chunk => { output += chunk.toString(); });
child.stderr.on("data", chunk => { output += chunk.toString(); });

function fail(message) {
  failures.push(message);
}

function snapshotDirectory(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map(name => {
    const filePath = path.join(dir, name);
    const stat = fs.statSync(filePath);
    return stat.isFile() ? { name, content: fs.readFileSync(filePath) } : null;
  }).filter(Boolean);
}

function restoreDirectory(dir, snapshot, existed) {
  fs.rmSync(dir, { recursive: true, force: true });
  if (!existed) return;
  fs.mkdirSync(dir, { recursive: true });
  snapshot.forEach(file => fs.writeFileSync(path.join(dir, file.name), file.content));
}

function hasSecurityHeaders(response) {
  const csp = response.headers["content-security-policy"] || "";
  return response.headers["x-content-type-options"] === "nosniff" &&
    response.headers["referrer-policy"] === "same-origin" &&
    response.headers["x-frame-options"] === "DENY" &&
    response.headers["cross-origin-opener-policy"] === "same-origin" &&
    Boolean(response.headers["permissions-policy"]) &&
    csp.includes("default-src 'self'") &&
    csp.includes("connect-src 'self' http://127.0.0.1:* http://localhost:* https:");
}

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers: options.headers || {}
    }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => {
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body, json });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function openSse(pathname = "/api/stream") {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: "GET",
      headers: { Accept: "text/event-stream" }
    }, res => {
      res.setEncoding("utf8");
      res.once("data", chunk => {
        resolve({ req, res, firstChunk: String(chunk) });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function expectCrossOriginWriteRejected(pathname, body, message) {
  const response = await request(pathname, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://evil.example"
    },
    body: JSON.stringify(body || {})
  });
  if (response.status !== 403) fail(`${message} rejects cross-origin browser writes`);
  if (response.json?.code !== "FORBIDDEN_ORIGIN") fail(`${message} reports FORBIDDEN_ORIGIN for cross-origin writes`);
}

async function expectCrossOriginGetRejected(pathname, message) {
  const response = await request(pathname, {
    headers: {
      Origin: "http://evil.example"
    }
  });
  if (response.status !== 403) fail(`${message} rejects cross-origin browser reads`);
  if (response.json?.code !== "FORBIDDEN_ORIGIN") fail(`${message} reports FORBIDDEN_ORIGIN for cross-origin reads`);
}

function waitForExit(timeoutMs = 2500) {
  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await request("/api/health");
      if (response.status === 200) return response;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Server did not become ready.\n${output}`);
}

async function stopServer() {
  if (stopped) return;
  stopped = true;
  child.kill("SIGTERM");
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 1500);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function main() {
  try {
    hadOriginalProfile = fs.existsSync(profilePath);
    if (hadOriginalProfile) originalProfile = fs.readFileSync(profilePath, "utf8");
    hadBackupDir = fs.existsSync(backupDir);
    originalBackups = snapshotDirectory(backupDir);

    const health = await waitForServer();
    const appVersion = health.json?.appVersion;
    const frontendVersion = health.json?.frontendVersion;
    if (!appVersion || appVersion === "16") fail("Health endpoint returns automatic app version");
    if (!frontendVersion || frontendVersion === "16") fail("Health endpoint returns automatic frontend version");
    if (!health.json?.requestId) fail("Health endpoint returns requestId");
    if (!Number.isInteger(health.json?.pid) || health.json.pid <= 0) fail("Health endpoint returns process id");
    if (!Number.isInteger(health.json?.uptimeSeconds) || health.json.uptimeSeconds < 0) fail("Health endpoint returns uptime seconds");
    if (!health.json?.startedAt || Number.isNaN(Date.parse(health.json.startedAt))) fail("Health endpoint returns startedAt timestamp");
    if (health.json?.storage?.profile?.path !== "user/profile.json") fail("Health endpoint reports profile storage path");
    if (typeof health.json?.storage?.profile?.exists !== "boolean") fail("Health endpoint reports whether profile storage exists");
    if (typeof health.json?.storage?.profile?.writable !== "boolean") fail("Health endpoint reports profile storage writability");
    if (typeof health.json?.storage?.profile?.directoryWritable !== "boolean") fail("Health endpoint reports profile directory writability");
    if (health.json?.checks?.profileWritable !== health.json?.storage?.profile?.writable) fail("Health profileWritable check reflects storage state");
    if (health.json?.config?.port?.value !== port || health.json.config.port.source !== "env" || health.json.config.port.valid !== true) fail("Health endpoint reports parsed port config");
    if (health.json?.config?.deepSeek?.timeoutMs?.value !== 10000 || health.json.config.deepSeek.timeoutMs.valid !== false) fail("Health endpoint reports invalid DeepSeek timeout fallback");
    if (health.json?.config?.deepSeek?.maxTokens?.value !== 260 || health.json.config.deepSeek.maxTokens.valid !== false) fail("Health endpoint reports invalid DeepSeek token fallback");
    if (health.json?.config?.serverTimeouts?.requestTimeoutMs?.value !== 30000 || health.json.config.serverTimeouts.requestTimeoutMs.valid !== false) fail("Health endpoint reports invalid request timeout fallback");
    if (health.json?.config?.admin?.tokenConfigured !== true || health.json.config.admin.tokenRequired !== false) fail("Health endpoint reports non-sensitive admin token state");
    if (!hasSecurityHeaders(health)) fail("API responses include baseline security headers");
    if (health.headers["access-control-allow-origin"] !== "*") fail("Health endpoint allows public local port discovery");

    const healthHead = await request("/api/health", { method: "HEAD" });
    if (healthHead.status !== 200) fail("HEAD health endpoint returns 200");
    if (healthHead.body !== "") fail("HEAD health endpoint returns no body");
    if (!/application\/json/.test(healthHead.headers["content-type"] || "")) fail("HEAD health endpoint keeps JSON content type");
    if (!healthHead.headers["content-length"]) fail("HEAD health endpoint includes content length");
    if (!hasSecurityHeaders(healthHead)) fail("HEAD health endpoint includes baseline security headers");

    const now = await request("/api/now-lite");
    if (now.status !== 200) fail("Now-lite endpoint returns 200");
    if (now.json?.frontendVersion !== frontendVersion) fail("Now-lite endpoint returns matching frontend version");
    if (now.json?.queue && Array.isArray(now.json.queue)) fail("Now-lite endpoint stays lightweight");
    if (!now.json?.requestId) fail("Now-lite endpoint returns requestId");
    if (now.headers["access-control-allow-origin"]) fail("Now-lite endpoint does not expose state cross-origin");

    const html = await request("/");
    if (html.status !== 200 || !html.body.includes(`/app.js?v=${frontendVersion}`)) fail("HTML returns auto cache-busted app asset");
    if (html.body.includes("__CLAUDIO_FRONTEND_VERSION__")) fail("HTML version token is rendered");
    if (!hasSecurityHeaders(html)) fail("HTML response includes baseline security headers");
    if (!/no-cache/i.test(html.headers["cache-control"] || "")) fail("HTML entry remains revalidated for updates");

    const serviceWorker = await request("/service-worker.js");
    if (serviceWorker.status !== 200 || !serviceWorker.body.includes(`claudio-music-${frontendVersion}`)) fail("Service worker cache uses frontend version");
    if (serviceWorker.body.includes("__CLAUDIO_FRONTEND_VERSION__")) fail("Service worker version token is rendered");
    if (!/no-cache/i.test(serviceWorker.headers["cache-control"] || "")) fail("Service worker remains revalidated for updates");

    const manifest = await request("/manifest.webmanifest");
    if (manifest.status !== 200 || !/application\/manifest\+json/.test(manifest.headers["content-type"] || "")) fail("Web manifest is served with manifest content type");
    if (!hasSecurityHeaders(manifest)) fail("Web manifest includes baseline security headers");
    if (manifest.json?.id !== "/?source=pwa" || manifest.json?.scope !== "/" || manifest.json?.lang !== "zh-CN") fail("Web manifest exposes app identity and scope");
    if (!Array.isArray(manifest.json?.shortcuts) || !manifest.json.shortcuts.some(item => item.url === "/?action=recommend")) fail("Web manifest exposes app shortcuts");
    if (!manifest.json?.icons?.some(icon => icon.src === "/icons/icon-192.png" && icon.type === "image/png")) fail("Web manifest exposes PNG install icons");
    if (!serviceWorker.body.includes("/manifest.webmanifest") || !serviceWorker.body.includes("/icons/icon.svg") || !serviceWorker.body.includes("/icons/icon-192.png") || !serviceWorker.body.includes("/icons/icon-512.png")) fail("Service worker caches install metadata");

    const icon192 = await request("/icons/icon-192.png");
    if (icon192.status !== 200 || icon192.headers["content-type"] !== "image/png") fail("192px PNG icon is served");
    if (Number(icon192.headers["content-length"] || 0) < 1000) fail("192px PNG icon has a real payload");
    const icon512 = await request("/icons/icon-512.png");
    if (icon512.status !== 200 || icon512.headers["content-type"] !== "image/png") fail("512px PNG icon is served");
    if (Number(icon512.headers["content-length"] || 0) < 3000) fail("512px PNG icon has a real payload");

    const app = await request(`/app.js?v=${frontendVersion}`);
    if (app.status !== 200 || !/javascript/.test(app.headers["content-type"] || "")) fail("App JavaScript asset is served");
    if (!hasSecurityHeaders(app)) fail("JavaScript asset includes baseline security headers");
    if (!/max-age=31536000/.test(app.headers["cache-control"] || "") || !/immutable/i.test(app.headers["cache-control"] || "")) fail("Versioned JavaScript asset is immutable cached");

    const appHead = await request(`/app.js?v=${frontendVersion}`, { method: "HEAD" });
    if (appHead.status !== 200) fail("HEAD JavaScript asset returns 200");
    if (appHead.body !== "") fail("HEAD JavaScript asset returns no body");
    if (!appHead.headers["content-length"]) fail("HEAD JavaScript asset includes content length");
    if (!hasSecurityHeaders(appHead)) fail("HEAD JavaScript asset includes baseline security headers");

    const appNotModified = await request(`/app.js?v=${frontendVersion}`, {
      headers: { "If-None-Match": app.headers.etag || "" }
    });
    if (app.headers.etag && appNotModified.status !== 304) fail("JavaScript asset supports ETag revalidation");

    const staticPost = await request(`/app.js?v=${frontendVersion}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    if (staticPost.status !== 405 || staticPost.headers.allow !== "GET, HEAD") fail("Static assets reject unsupported methods with Allow header");

    const styles = await request(`/styles.css?v=${frontendVersion}`);
    if (styles.status !== 200 || !/text\/css/.test(styles.headers["content-type"] || "")) fail("CSS asset is served");
    if (!hasSecurityHeaders(styles)) fail("CSS asset includes baseline security headers");
    if (!/max-age=31536000/.test(styles.headers["cache-control"] || "") || !/immutable/i.test(styles.headers["cache-control"] || "")) fail("Versioned CSS asset is immutable cached");

    const smokeLibraryFileName = `smoke-library-refresh-${process.pid}-${Date.now()}.mp3`;
    smokeLibraryFilePath = path.join(musicDir, smokeLibraryFileName);
    fs.mkdirSync(musicDir, { recursive: true });
    fs.writeFileSync(smokeLibraryFilePath, "");
    const libraryRefresh = await request("/api/library/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    if (libraryRefresh.status !== 200 || libraryRefresh.json?.reason !== "library-refresh") fail("Library refresh endpoint returns refreshed state");
    if (!libraryRefresh.json?.library || libraryRefresh.json.library.queueSize !== libraryRefresh.json?.queue?.length) fail("Library refresh reports queue size");
    if (!libraryRefresh.json?.queue?.some(track => track.audioUrl === `/music/${encodeURIComponent(smokeLibraryFileName)}`)) fail("Library refresh immediately discovers new local files");
    const crossOriginLibraryRefresh = await request("/api/library/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://evil.example"
      },
      body: "{}"
    });
    if (crossOriginLibraryRefresh.status !== 403 || crossOriginLibraryRefresh.json?.code !== "FORBIDDEN_ORIGIN") fail("Library refresh rejects cross-origin browser writes");

    const apiPreflight = await request("/api/play", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:3999",
        "Access-Control-Request-Method": "POST"
      }
    });
    if (apiPreflight.status !== 204 || apiPreflight.body !== "") fail("Known API preflight returns empty 204");
    if (apiPreflight.headers.allow !== "POST, OPTIONS") fail("Known API preflight includes Allow header");
    if (apiPreflight.headers["access-control-allow-origin"]) fail("State-changing API preflight does not grant cross-origin access");
    if (apiPreflight.headers["access-control-allow-methods"] !== "POST") fail("Known API preflight lists allowed method");
    if (!/x-claudio-token/i.test(apiPreflight.headers["access-control-allow-headers"] || "")) fail("Known API preflight allows Claudio auth header");

    const healthPreflight = await request("/api/health", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:3999",
        "Access-Control-Request-Method": "GET"
      }
    });
    if (healthPreflight.status !== 204 || healthPreflight.headers["access-control-allow-origin"] !== "*") fail("Health preflight allows public local discovery");

    const apiWrongMethod = await request("/api/play");
    if (apiWrongMethod.status !== 405 || apiWrongMethod.headers.allow !== "POST, OPTIONS") fail("Known API paths reject unsupported methods with Allow header");
    if (apiWrongMethod.json?.code !== "METHOD_NOT_ALLOWED") fail("Known API wrong method reports METHOD_NOT_ALLOWED");

    await expectCrossOriginWriteRejected("/api/user/profile", { profile: { settings: { theme: "light" } } }, "Profile import");
    await expectCrossOriginWriteRejected("/api/play", { playing: false }, "Playback control");
    await expectCrossOriginWriteRejected("/api/chat", { message: "hello" }, "Chat endpoint");
    await expectCrossOriginGetRejected("/api/next", "Next track");
    await expectCrossOriginGetRejected("/api/previous", "Previous track");
    await expectCrossOriginGetRejected("/api/user/profile", "Profile read");
    await expectCrossOriginGetRejected("/api/user/profile/backups", "Profile backup read");

    const crossOriginHealth = await request("/api/health", {
      headers: { Origin: "http://evil.example" }
    });
    if (crossOriginHealth.status !== 200 || crossOriginHealth.headers["access-control-allow-origin"] !== "*") fail("Health remains public for cross-origin local discovery");

    const restoreSeed = await request("/api/user/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: {
          favorites: [{
            id: "smoke-restore-original",
            title: "Smoke Restore Original",
            artist: "Smoke Artist",
            duration: 120,
            source: "smoke"
          }],
          history: [],
          preferences: {},
          settings: { theme: "dark", volume: 0.3 }
        }
      })
    });
    if (restoreSeed.status !== 200 || restoreSeed.json?.profile?.favorites?.[0]?.id !== "smoke-restore-original") fail("Profile restore seed import works");

    const profileImport = await request("/api/user/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app: "Claudio Music",
        exportedAt: "2026-01-01T00:00:00.000Z",
        profile: {
          favorites: [{
            id: "smoke-import-track",
            title: "Smoke Import Track",
            artist: "Smoke Artist",
            duration: 300,
            source: "smoke"
          }],
          history: [],
          preferences: {
            artists: ["Smoke Artist"],
            genres: ["lofi"],
            avoid: ["noise"]
          },
          settings: {
            theme: "light",
            volume: 1.5,
            repeatMode: 7
          }
        }
      })
    });
    if (profileImport.status !== 200 || !profileImport.json?.ok) fail("Profile import endpoint accepts exported JSON");
    if (profileImport.json?.profile?.favorites?.[0]?.title !== "Smoke Import Track") fail("Profile import returns imported favorites");
    if (profileImport.json?.profile?.settings?.volume !== 1) fail("Profile import sanitizes settings");
    if (profileImport.json?.profile?.settings?.repeatMode !== 2) fail("Profile import sanitizes repeat mode");
    if (profileImport.json?.summary?.favorites !== 1 || profileImport.json?.summary?.history !== 0 || profileImport.json?.summary?.preferenceItems !== 3) fail("Profile import returns sanitized summary counts");
    const backupPathPattern = /^user\/backups\/profile-\d{8}T\d{6}Z(?:-\d+)?\.json$/;
    if (!backupPathPattern.test(profileImport.json?.backupPath || "")) fail("Profile import creates a timestamped backup");
    if (!fs.existsSync(path.join(root, profileImport.json?.backupPath || ""))) fail("Profile import backup exists on disk");
    if (profileImport.json?.state?.reason !== "profile-import") fail("Profile import returns refreshed app state");
    if (profileImport.json?.state?.summary?.favorites !== 1) fail("Profile import includes summary in refreshed state");
    if (profileImport.json?.state?.backupPath !== profileImport.json?.backupPath) fail("Profile import includes backup path in refreshed state");
    const importedProfile = await request("/api/user/profile");
    if (importedProfile.json?.profile?.favorites?.[0]?.id !== "smoke-import-track") fail("Profile import persists imported profile");
    if (importedProfile.headers["access-control-allow-origin"]) fail("Profile endpoint does not expose user data cross-origin");
    await expectCrossOriginGetRejected("/api/user/profile", "User profile");

    const secondProfileImport = await request("/api/user/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: {
          favorites: [{
            id: "smoke-import-track-2",
            title: "Smoke Import Track 2",
            artist: "Smoke Artist",
            duration: 240,
            source: "smoke"
          }],
          history: [],
          preferences: {},
          settings: { theme: "light", volume: 0.7, repeatMode: 1 }
        }
      })
    });
    if (secondProfileImport.status !== 200 || !secondProfileImport.json?.ok) fail("Profile import accepts a second immediate import");
    if (!backupPathPattern.test(secondProfileImport.json?.backupPath || "")) fail("Second profile import creates a timestamped backup");
    if (secondProfileImport.json?.backupPath === profileImport.json?.backupPath) fail("Second profile import does not overwrite the first backup");
    if (!fs.existsSync(path.join(root, secondProfileImport.json?.backupPath || ""))) fail("Second profile import backup exists on disk");
    if (!fs.existsSync(path.join(root, profileImport.json?.backupPath || ""))) fail("First profile import backup remains on disk after a second import");
    if (secondProfileImport.json?.profile?.favorites?.[0]?.id !== "smoke-import-track-2") fail("Second profile import returns imported favorites");

    const profileBackups = await request("/api/user/profile/backups");
    if (profileBackups.status !== 200 || !Array.isArray(profileBackups.json?.backups)) fail("Profile backups endpoint returns a backup list");
    if (!profileBackups.json?.backups?.some(backup => backup.backupPath === profileImport.json?.backupPath)) fail("Profile backups endpoint includes the first import backup");
    if (!profileBackups.json?.backups?.some(backup => backup.backupPath === secondProfileImport.json?.backupPath)) fail("Profile backups endpoint includes the second import backup");
    if (!profileBackups.json?.backups?.every(backup => backupPathPattern.test(backup.backupPath || "") && backup.createdAt && Number(backup.size) >= 0)) fail("Profile backups endpoint returns sanitized backup metadata");
    if (profileBackups.headers["access-control-allow-origin"]) fail("Profile backups endpoint does not expose user backup metadata cross-origin");
    await expectCrossOriginGetRejected("/api/user/profile/backups", "Profile backups");

    const badRestore = await request("/api/user/profile/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupPath: "../profile.json" })
    });
    if (badRestore.status !== 400 || badRestore.json?.code !== "VALIDATION_ERROR") fail("Profile restore rejects unsafe backup paths");

    const restoreProfile = await request("/api/user/profile/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupPath: profileImport.json?.backupPath })
    });
    if (restoreProfile.status !== 200 || restoreProfile.json?.state?.reason !== "profile-restore") fail("Profile restore endpoint restores from backup");
    if (restoreProfile.json?.profile?.favorites?.[0]?.id !== "smoke-restore-original") fail("Profile restore brings back pre-import profile");

    const repeatSettings = await request("/api/user/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repeatMode: 1 })
    });
    if (repeatSettings.status !== 200 || repeatSettings.json?.settings?.repeatMode !== 1) fail("Settings endpoint persists repeat mode");
    if (repeatSettings.json?.profile?.settings?.repeatMode !== 1) fail("Profile exposes persisted repeat mode");

    const postNext = await request("/api/next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    if (postNext.status !== 200 || postNext.json?.reason !== "next") fail("POST next request advances the queue");
    const plainGetNext = await request("/api/next");
    if (plainGetNext.status !== 405 || plainGetNext.headers.allow !== "GET, POST, OPTIONS") fail("Plain GET next no longer mutates state");
    const legacyGetNext = await request("/api/next?legacy=1");
    if (legacyGetNext.status !== 200 || legacyGetNext.json?.reason !== "next") fail("Explicit legacy GET next request still works");

    const apiSideEffectHead = await request("/api/next", { method: "HEAD" });
    if (apiSideEffectHead.status !== 405 || apiSideEffectHead.headers.allow !== "GET, POST, OPTIONS") fail("Track navigation API does not allow HEAD");
    if (apiSideEffectHead.body !== "") fail("Rejected API HEAD returns no body");

    const missingApi = await request("/api/not-real");
    if (missingApi.status !== 404 || missingApi.json?.code !== "API_NOT_FOUND") fail("Unknown API paths still return API_NOT_FOUND");

    const malformed = await request("/%E0%A4%A");
    if (malformed.status !== 400) fail("Malformed URL encoding returns 400");
    if (malformed.json?.code !== "INVALID_URL_ENCODING") fail("Malformed URL reports INVALID_URL_ENCODING");
    if (!malformed.json?.requestId) fail("Malformed URL response includes requestId");

    const aiStatus = await request("/api/ai/status");
    if (aiStatus.status !== 200 || aiStatus.json?.ai?.adminTokenRequired !== false) fail("AI admin token is optional by default for local use");

    const aiConfig = await request("/api/ai/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "x" })
    });
    if (aiConfig.status !== 200 || aiConfig.json?.ai?.enabled !== true) fail("AI config endpoint works without admin token by default");
    if (aiConfig.json?.ai?.adminTokenRequired !== false) fail("AI config reports local no-token mode");

    const aiClear = await request("/api/ai/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    if (aiClear.status !== 200 || aiClear.json?.ai?.enabled !== false) fail("AI clear endpoint works without admin token by default");

    const unsupportedType = await request("/api/play", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "playing=true"
    });
    if (unsupportedType.status !== 415) fail("POST endpoints reject non-JSON content type");
    if (unsupportedType.json?.code !== "UNSUPPORTED_MEDIA_TYPE") fail("Non-JSON POST reports UNSUPPORTED_MEDIA_TYPE");

    const sse = await openSse();
    if (sse.res.statusCode !== 200 || !/text\/event-stream/.test(sse.res.headers["content-type"] || "")) fail("SSE stream opens");
    if (!sse.firstChunk.includes("event: now")) fail("SSE stream sends initial state");
    if (!hasSecurityHeaders(sse.res)) fail("SSE stream includes baseline security headers");
    if (sse.res.headers["access-control-allow-origin"]) fail("SSE stream does not expose live state cross-origin");
    stopped = true;
    const exiting = waitForExit();
    child.kill("SIGTERM");
    const exit = await exiting;
    if (!exit || (exit.code !== 0 && exit.signal !== "SIGTERM")) fail("Server exits on SIGTERM with an open SSE client");

    if (!output.includes("#")) fail("Request log includes requestId marker");

    if (failures.length) {
      console.error(`HTTP smoke failed:\n- ${failures.join("\n- ")}\n\nServer output:\n${output}`);
      process.exitCode = 1;
      return;
    }

    console.log("HTTP smoke checks passed.");
  } finally {
    await stopServer();
    if (originalProfile !== null) {
      fs.mkdirSync(path.dirname(profilePath), { recursive: true });
      fs.writeFileSync(profilePath, originalProfile, "utf8");
    } else if (!hadOriginalProfile) {
      try {
        fs.rmSync(profilePath, { force: true });
      } catch {}
    }
    restoreDirectory(backupDir, originalBackups, hadBackupDir);
    if (smokeLibraryFilePath) {
      try {
        fs.rmSync(smokeLibraryFilePath, { force: true });
      } catch {}
    }
  }
}

child.once("exit", code => {
  if (!stopped && code !== 0) {
    console.error(`Server exited unexpectedly with code ${code}.\n${output}`);
    process.exit(1);
  }
});

main().catch(async error => {
  console.error(error.stack || error.message);
  await stopServer();
  process.exit(1);
});
