const { spawn } = require("child_process");
const http = require("http");

const root = require("path").join(__dirname, "..");
const port = 4700 + Math.floor(Math.random() * 500);
const env = {
  ...process.env,
  PORT: String(port),
  CLAUDIO_SKIP_ENV: "1",
  CLAUDIO_ADMIN_TOKEN: "smoke-token",
  CLAUDIO_REQUIRE_ADMIN_TOKEN: "1"
};

const child = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env,
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
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
      const health = await request("/api/health");
      if (health.status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Server did not start.\n${output}`);
}

async function runServer(checkEnv, check) {
  const localOutput = [];
  const server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, ...checkEnv },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", chunk => { localOutput.push(chunk.toString()); });
  server.stderr.on("data", chunk => { localOutput.push(chunk.toString()); });
  try {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        const response = await requestWithPort(Number(checkEnv.PORT), "/api/health");
        if (response.status === 200) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    await check(Number(checkEnv.PORT));
  } finally {
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 2500);
        server.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}

function requestWithPort(targetPort, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: targetPort,
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

async function stopServer() {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 2500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main() {
  try {
    await waitForServer();

    const status = await request("/api/ai/status");
    if (status.status !== 200 || status.json?.ai?.adminTokenRequired !== true || status.json?.ai?.adminTokenConfigured !== true) fail("Strict mode reports admin token requirement");

    const missingToken = await request("/api/ai/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "x" })
    });
    if (missingToken.status !== 401 || missingToken.json?.code !== "UNAUTHORIZED") fail("Strict mode rejects missing admin token");

    const wrongToken = await request("/api/ai/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Claudio-Token": "wrong-token"
      },
      body: JSON.stringify({ apiKey: "x" })
    });
    if (wrongToken.status !== 401 || wrongToken.json?.code !== "UNAUTHORIZED") fail("Strict mode rejects wrong admin token");

    const withToken = await request("/api/ai/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Claudio-Token": "smoke-token"
      },
      body: JSON.stringify({ apiKey: "x" })
    });
    if (withToken.status !== 200 || withToken.json?.ai?.enabled !== true) fail("Strict mode accepts the configured admin token");

    const withBearerToken = await request("/api/ai/clear", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer smoke-token"
      },
      body: "{}"
    });
    if (withBearerToken.status !== 200 || withBearerToken.json?.ai?.enabled !== false) fail("Strict mode accepts bearer admin token");

    await runServer({
      PORT: String(port + 501),
      CLAUDIO_SKIP_ENV: "1",
      CLAUDIO_REQUIRE_ADMIN_TOKEN: "1",
      CLAUDIO_ADMIN_TOKEN: ""
    }, async strictPort => {
      const unconfiguredStatus = await requestWithPort(strictPort, "/api/ai/status");
      if (unconfiguredStatus.status !== 200 || unconfiguredStatus.json?.ai?.adminTokenRequired !== true || unconfiguredStatus.json?.ai?.adminTokenConfigured !== false) fail("Strict mode reports missing admin token configuration");
      const unconfiguredConfig = await requestWithPort(strictPort, "/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "x" })
      });
      if (unconfiguredConfig.status !== 500 || unconfiguredConfig.json?.code !== "ADMIN_TOKEN_REQUIRED") fail("Strict mode reports missing admin token as configuration error");
    });

    if (failures.length) {
      console.error(`Admin token smoke failed:\n- ${failures.join("\n- ")}\n\nServer output:\n${output}`);
      process.exitCode = 1;
      return;
    }

    console.log("Admin token smoke checks passed.");
  } finally {
    await stopServer();
  }
}

main().catch(async error => {
  await stopServer();
  console.error(error);
  process.exit(1);
});
