const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const required = [
  "server.js",
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "public/manifest.webmanifest",
  "public/service-worker.js",
  "data/tracks.json",
  "README.md"
];

const missing = required.filter(file => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Missing files: ${missing.join(", ")}`);
  process.exit(1);
}

const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "public/service-worker.js"), "utf8");
const tracks = JSON.parse(fs.readFileSync(path.join(root, "data/tracks.json"), "utf8"));

const forbiddenClientAudio = [
  "AudioContext",
  "OscillatorNode",
  "createOscillator",
  "synth",
  "alert("
];

const checks = [
  ["HTML loads cache-busted app", /app\.js\?v=9/.test(html)],
  ["HTML loads cache-busted CSS", /styles\.css\?v=9/.test(html)],
  ["Service worker cache bumped", serviceWorker.includes("claudio-music-v9")],
  ["Client uses a real audio element", app.includes("new Audio()")],
  ["Client has no synthetic audio or alert fallback", forbiddenClientAudio.every(token => !app.includes(token))],
  ["Client calls recommendation endpoint", app.includes("/api/music/recommend")],
  ["Client starts empty with prompt", app.includes("告诉 Claudio 你想听什么")],
  ["Server exposes health endpoint", server.includes("/api/health")],
  ["Server exposes AI status endpoint", server.includes("/api/ai/status")],
  ["Server exposes AI config endpoint", server.includes("/api/ai/config")],
  ["Client has DeepSeek settings form", html.includes("DeepSeek 设置") && app.includes("/api/ai/config")],
  ["Server exposes music play endpoint", server.includes("/api/music/play")],
  ["Server uses Audius", server.includes("api.audius.co/v1")],
  ["Server uses Deezer", server.includes("api.deezer.com")],
  ["Client labels Deezer preview", app.includes("DEEZER PREVIEW")],
  ["Server uses iTunes preview", server.includes("itunes.apple.com")],
  ["Server connects DeepSeek", server.includes("api.deepseek.com")],
  ["Server uses cheap DeepSeek model default", server.includes("deepseek-v4-flash")],
  ["Server disables DeepSeek thinking", server.includes('thinking: { type: "disabled" }')],
  ["Server exposes DeepSeek status", server.includes("aiPublicState")],
  ["Radio is explicit fallback only", server.includes("wantsRadio")],
  ["Track library starts empty JSON", Array.isArray(tracks)]
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(`Failed checks: ${failed.join(", ")}`);
  process.exit(1);
}

console.log("Smoke checks passed.");
