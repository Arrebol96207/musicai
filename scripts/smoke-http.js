const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const root = path.join(__dirname, "..");
const port = 3900 + Math.floor(Math.random() * 1000);
const env = {
  ...process.env,
  PORT: String(port),
  CLAUDIO_SKIP_ENV: "1",
  CLAUDIO_ADMIN_TOKEN: "smoke-token"
};

const child = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
let stopped = false;
const failures = [];

child.stdout.on("data", chunk => { output += chunk.toString(); });
child.stderr.on("data", chunk => { output += chunk.toString(); });

function fail(message) {
  failures.push(message);
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
    const health = await waitForServer();
    const appVersion = health.json?.appVersion;
    const frontendVersion = health.json?.frontendVersion;
    if (!appVersion || appVersion === "16") fail("Health endpoint returns automatic app version");
    if (!frontendVersion || frontendVersion === "16") fail("Health endpoint returns automatic frontend version");
    if (!health.json?.requestId) fail("Health endpoint returns requestId");
    if (health.json?.host !== "127.0.0.1") fail("Server defaults to loopback host");

    const now = await request("/api/now-lite");
    if (now.status !== 200) fail("Now-lite endpoint returns 200");
    if (now.json?.frontendVersion !== frontendVersion) fail("Now-lite endpoint returns matching frontend version");
    if (now.json?.queue && Array.isArray(now.json.queue)) fail("Now-lite endpoint stays lightweight");
    if (!now.json?.requestId) fail("Now-lite endpoint returns requestId");

    const html = await request("/");
    if (html.status !== 200 || !html.body.includes(`/app.js?v=${frontendVersion}`)) fail("HTML returns auto cache-busted app asset");
    if (html.body.includes("__CLAUDIO_FRONTEND_VERSION__")) fail("HTML version token is rendered");

    const serviceWorker = await request("/service-worker.js");
    if (serviceWorker.status !== 200 || !serviceWorker.body.includes(`claudio-music-${frontendVersion}`)) fail("Service worker cache uses frontend version");
    if (serviceWorker.body.includes("__CLAUDIO_FRONTEND_VERSION__")) fail("Service worker version token is rendered");

    const app = await request(`/app.js?v=${frontendVersion}`);
    if (app.status !== 200 || !/javascript/.test(app.headers["content-type"] || "")) fail("App JavaScript asset is served");

    const styles = await request(`/styles.css?v=${frontendVersion}`);
    if (styles.status !== 200 || !/text\/css/.test(styles.headers["content-type"] || "")) fail("CSS asset is served");

    const malformed = await request("/%E0%A4%A");
    if (malformed.status !== 400) fail("Malformed URL encoding returns 400");
    if (malformed.json?.code !== "INVALID_URL_ENCODING") fail("Malformed URL reports INVALID_URL_ENCODING");
    if (!malformed.json?.requestId) fail("Malformed URL response includes requestId");

    const restore = await request("/api/queue/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tracks: [{
          id: "smoke-restore-track",
          title: "Smoke Restore",
          artist: "Smoke",
          duration: 30,
          source: "itunes",
          audioUrl: "https://example.com/preview.mp3"
        }]
      })
    });
    if (restore.status !== 200 || restore.json?.reason !== "restore" || restore.json?.queueSize < 1) fail("Queue restore endpoint restores saved snapshots");

    const clear = await request("/api/queue/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    if (clear.status !== 200 || clear.json?.reason !== "clear") fail("Queue clear endpoint still clears restored queue");

    const aiConfig = await request("/api/ai/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "x" })
    });
    if (aiConfig.status !== 401 || aiConfig.json?.code !== "UNAUTHORIZED") fail("AI config endpoint requires admin token");

    const authedAiConfig = await request("/api/ai/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-claudio-token": "smoke-token"
      },
      body: JSON.stringify({ apiKey: "x", model: "deepseek-v4-flash", apiBase: "https://api.deepseek.com" })
    });
    if (authedAiConfig.status !== 200 || authedAiConfig.json?.ai?.enabled !== true) fail("AI config endpoint accepts valid admin token");

    if (!output.includes("#")) fail("Request log includes requestId marker");

    if (failures.length) {
      console.error(`HTTP smoke failed:\n- ${failures.join("\n- ")}\n\nServer output:\n${output}`);
      process.exitCode = 1;
      return;
    }

    console.log("HTTP smoke checks passed.");
  } finally {
    await stopServer();
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
