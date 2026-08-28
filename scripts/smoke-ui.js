const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const root = path.join(__dirname, "..");
const outDir = path.join(root, ".tmp", "screenshots");
const profileDir = path.join(root, ".tmp", "edge-smoke-profile");
const profilePath = path.join(root, "user", "profile.json");
const backupDir = path.join(root, "user", "backups");
const cdpPort = Number(process.env.CLAUDIO_UI_CDP_PORT || 9223);
const startPort = Number(process.env.PORT || (43000 + Math.floor(Math.random() * 6000)));
const edgeCandidates = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);

let server;
let browser;
let ws;
let activeTargetId = "";
let messageId = 0;
let originalProfile = null;
let hadOriginalProfile = false;
let originalBackups = [];
let hadBackupDir = false;
const failures = [];

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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findEdge() {
  return edgeCandidates.find(candidate => fs.existsSync(candidate));
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || "GET", timeout: options.timeout || 1000 }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          error.body = body;
          reject(error);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

function requestText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || "GET", timeout: options.timeout || 1000 }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

async function waitForHealth(expectedPid) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    for (let port = startPort; port <= startPort + 10; port += 1) {
      try {
        const health = await requestJson(`http://127.0.0.1:${port}/api/health`);
        if (health.app === "ClaudioMusic" && (!expectedPid || health.pid === expectedPid)) return { port, health };
      } catch {}
    }
    await delay(200);
  }
  throw new Error("UI smoke server did not become healthy (no instance on the expected port range matching this test).");
}

async function waitForDevTools() {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const version = await requestJson(`http://127.0.0.1:${cdpPort}/json/version`);
      if (version.webSocketDebuggerUrl) return;
    } catch {}
    await delay(150);
  }
  throw new Error("Edge DevTools endpoint did not become ready.");
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      try {
        socket.close();
      } catch {}
      reject(new Error("CDP websocket connection timed out."));
    }, 10000);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", error => {
      clearTimeout(timeout);
      reject(error);
    }, { once: true });
    socket.addEventListener("open", () => clearTimeout(timeout), { once: true });
  });
}

function cdp(method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error(`CDP socket is not open for ${method}.`));
      return;
    }
    const id = ++messageId;
    const timeout = setTimeout(() => {
      ws?.removeEventListener("message", onMessage);
      reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    const onMessage = event => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      clearTimeout(timeout);
      ws.removeEventListener("message", onMessage);
      if (payload.error) reject(new Error(payload.error.message || method));
      else resolve(payload.result || {});
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function cdpSend(socket, method, params = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error(`CDP socket is not open for ${method}.`));
      return;
    }
    const id = ++messageId;
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    const onMessage = event => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      if (payload.error) reject(new Error(payload.error.message || method));
      else resolve(payload.result || {});
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function gracefullyCloseEdgeOnPort(port) {
  // Edge 注册了 RegisterApplicationRestart：强杀会被 Windows 重启管理器按原参数复活，
  // 复活的无头进程会一直锁住 profile 目录导致下次 rmSync EBUSY，因此必须走 CDP 优雅关闭
  try {
    const version = await requestJson(`http://127.0.0.1:${port}/json/version`, { timeout: 1200 });
    if (!version?.webSocketDebuggerUrl) return;
    const socket = await connectCdp(version.webSocketDebuggerUrl);
    await cdpSend(socket, "Browser.close", {}, 3000).catch(() => {});
    try {
      socket.close();
    } catch {}
    await delay(1500);
  } catch {}
}

async function openTarget(url) {
  const target = await requestJson(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  activeTargetId = target.id || "";
  return target.webSocketDebuggerUrl;
}

async function closeActiveTarget() {
  if (ws) {
    try {
      ws.close();
    } catch {}
    ws = null;
  }
  if (!activeTargetId) return;
  const targetId = activeTargetId;
  activeTargetId = "";
  await requestText(`http://127.0.0.1:${cdpPort}/json/close/${encodeURIComponent(targetId)}`).catch(() => {});
  await delay(100);
}

async function waitForLoad() {
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 5000);
    const onMessage = event => {
      const payload = JSON.parse(event.data);
      if (payload.method === "Page.loadEventFired") {
        clearTimeout(timeout);
        ws.removeEventListener("message", onMessage);
        resolve();
      }
    };
    ws.addEventListener("message", onMessage);
  });
  await delay(1200);
}

async function captureScreenshotPng(viewport, fromSurface = true) {
  const options = {
    format: "png",
    fromSurface,
    captureBeyondViewport: false
  };
  if (!viewport.captureVisibleViewport) {
    options.clip = {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
      scale: 1
    };
  }
  return cdp("Page.captureScreenshot", options);
}

async function inspectScreenshotPng(base64, viewport) {
  const dataUrl = `data:image/png;base64,${base64}`;
  const result = await cdp("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const sample = (x, y) => {
          const data = ctx.getImageData(Math.min(canvas.width - 1, Math.max(0, x)), Math.min(canvas.height - 1, Math.max(0, y)), 1, 1).data;
          return [data[0], data[1], data[2]];
        };
        const close = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 24;
        const vivid = color => Math.max(...color) - Math.min(...color) > 30 && color[0] + color[1] + color[2] > 90;
        const offset = Math.floor(${viewport.width} / 2);
        const points = [[60, 60], [120, 420], [170, 460], [90, 210]];
        const repeatedHalfSamples = ${viewport.width} >= 1000
          ? points.filter(([x, y]) => {
              const left = sample(x, y);
              const right = sample(x + offset, y);
              return vivid(left) && close(left, right);
            }).length
          : 0;
        resolve({ width: canvas.width, height: canvas.height, repeatedHalfSamples });
      };
      img.onerror = () => resolve({ width: 0, height: 0, repeatedHalfSamples: 999 });
      img.src = ${JSON.stringify(dataUrl)};
    })`
  });
  return result.result.value;
}

function screenshotByteLength(screenshot) {
  return Buffer.byteLength(screenshot?.data || "", "base64");
}

function screenshotProblem(viewport, screenshot, metrics) {
  const minBytes = viewport.minBytes || 0;
  const byteLength = screenshotByteLength(screenshot);
  if (metrics.width !== viewport.width || metrics.height !== viewport.height) {
    return `unexpected dimensions (${metrics.width}x${metrics.height})`;
  }
  if (byteLength < minBytes) {
    return `too small (${byteLength} bytes)`;
  }
  if (metrics.repeatedHalfSamples >= 2) {
    return "repeated viewport tiles";
  }
  return "";
}

function betterScreenshotCandidate(candidate, best) {
  if (!best) return true;
  if (!candidate.problem && best.problem) return true;
  if (candidate.problem && !best.problem) return false;
  return candidate.screenshotMetrics.byteLength > best.screenshotMetrics.byteLength;
}

async function settleViewportForScreenshot() {
  await cdp("Page.bringToFront").catch(() => {});
  await cdp("Runtime.evaluate", {
    awaitPromise: true,
    expression: `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
  });
}

async function captureReliableScreenshot(viewport) {
  const attempts = [
    { fromSurface: true, waitMs: 0 },
    { fromSurface: false, waitMs: 250 },
    { fromSurface: true, waitMs: 500 },
    { fromSurface: false, waitMs: 800 }
  ];
  let best = null;

  for (const attempt of attempts) {
    if (attempt.waitMs) await delay(attempt.waitMs);
    await settleViewportForScreenshot();
    const screenshot = await captureScreenshotPng(viewport, attempt.fromSurface);
    const screenshotMetrics = await inspectScreenshotPng(screenshot.data, viewport);
    screenshotMetrics.byteLength = screenshotByteLength(screenshot);
    screenshotMetrics.fromSurface = attempt.fromSurface;
    screenshotMetrics.captureAttempts = (best?.screenshotMetrics.captureAttempts || 0) + 1;
    const problem = screenshotProblem(viewport, screenshot, screenshotMetrics);
    const candidate = { screenshot, screenshotMetrics, problem };
    if (betterScreenshotCandidate(candidate, best)) best = candidate;
    if (!problem) return candidate;
  }

  return best;
}

async function captureViewport(url, viewport) {
  await closeActiveTarget();
  ws = await connectCdp(await openTarget(url));
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile
  });
  await cdp("Emulation.setVisibleSize", {
    width: viewport.width,
    height: viewport.height
  });
  await cdp("Page.navigate", { url });
  await waitForLoad();
  const theme = viewport.theme === "light" ? "light" : "dark";
  const exerciseInteractions = viewport.exerciseInteractions !== false;
  await cdp("Runtime.evaluate", {
    awaitPromise: true,
    expression: `
      (async () => {
      localStorage.setItem("claudio-theme", ${JSON.stringify(theme)});
      document.querySelector('[data-theme="${theme}"]')?.click();
      if (!${viewport.shortcutExpect ? "true" : "false"}) {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
      window.__copiedTrackText = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async text => { window.__copiedTrackText = text; } }
      });
      const waitForText = async (text, timeoutMs = 1200) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (document.body.innerText.includes(text)) return true;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return document.body.innerText.includes(text);
      };
      if (${exerciseInteractions}) {
        document.querySelector("#copyTrackBtn")?.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        window.__copiedTrackToastVisible = document.body.innerText.includes("已复制当前歌曲");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
        window.__queueShortcutFocused = document.activeElement?.id === "queueSearch";
        document.activeElement?.blur();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true }));
        window.__shortcutDialogOpen = !document.querySelector("#shortcutOverlay")?.hasAttribute("hidden");
        window.__shortcutDialogRole = document.querySelector("#shortcutOverlay")?.getAttribute("role") || "";
        window.__shortcutDialogFocused = document.activeElement?.id === "closeShortcutBtn";
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
        window.__shortcutTabTrapped = document.activeElement?.id === "closeShortcutBtn";
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
        window.__shortcutShiftTabTrapped = document.activeElement?.id === "closeShortcutBtn";
        document.querySelector("#closeShortcutBtn")?.click();
        window.__shortcutFocusRestored = document.querySelector("#shortcutOverlay")?.hasAttribute("hidden") && document.activeElement?.id !== "closeShortcutBtn";
        document.activeElement?.blur();
        window.__copiedTrackText = "";
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "C", bubbles: true, cancelable: true }));
        window.dispatchEvent(new Event("online"));
        const queueSearch = document.querySelector("#queueSearch");
        if (queueSearch) {
          queueSearch.value = "太阳";
          queueSearch.dispatchEvent(new Event("input", { bubbles: true }));
        }
        window.__copiedQueueText = "";
        const originalWriteText = navigator.clipboard.writeText;
        navigator.clipboard.writeText = async text => {
          window.__copiedQueueText = text;
          return originalWriteText(text);
        };
        document.querySelector("#copyQueueBtn")?.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        window.__copiedQueueToastVisible = document.body.innerText.includes("已复制筛选队列");
        document.querySelector("#refreshLibraryBtn")?.click();
        window.__libraryRefreshStatus = await waitForText("曲库已刷新");
        window.__libraryRefreshQueueText = document.querySelector("#queueCount")?.textContent || "";
        const repeatBeforeTitle = document.querySelector("#repeatBtn")?.title || "";
        const repeatExpected = repeatBeforeTitle.includes("列表循环")
          ? { toast: "单曲循环", title: "单曲循环" }
          : repeatBeforeTitle.includes("单曲循环")
            ? { toast: "顺序播放", title: "顺序" }
            : { toast: "列表循环", title: "列表循环" };
        document.querySelector("#repeatBtn")?.click();
        window.__repeatPersistToastVisible = await waitForText(repeatExpected.toast);
        window.__repeatPersistTitle = document.querySelector("#repeatBtn")?.title || "";
        window.__repeatPersistExpectedTitle = repeatExpected.title;
        window.__profileExportName = "";
        window.__profileExportHref = "";
        window.__profileExportBlobType = "";
        window.__profileExportRevoked = "";
        URL.createObjectURL = blob => {
          window.__profileExportBlobType = blob.type || "";
          return "blob:claudio-profile-smoke";
        };
        URL.revokeObjectURL = url => { window.__profileExportRevoked = url; };
        HTMLAnchorElement.prototype.click = function() {
          window.__profileExportName = this.download || "";
          window.__profileExportHref = this.href || "";
        };
        await exportProfile();
        window.__exportedProfileToastVisible = document.body.innerText.includes("已导出本地资料");
        const importPayload = {
          app: "Claudio Music",
          exportedAt: "2026-01-01T00:00:00.000Z",
          profile: {
            favorites: [{
              id: "smoke-ui-import",
              title: "Smoke UI Import",
              artist: "Smoke Artist",
              duration: 180,
              source: "smoke"
            }],
            history: [],
            preferences: { artists: ["Smoke Artist"], genres: ["lofi"], avoid: ["noise"] },
            settings: { theme: ${JSON.stringify(theme)}, volume: 0.42, repeatMode: 2 }
          }
        };
        await importProfileFile(new File([JSON.stringify(importPayload)], "claudio-profile-smoke.json", { type: "application/json" }));
        window.__importedProfileStatus = document.body.innerText.includes("已导入本地资料");
        window.__importedProfileSummary = document.body.innerText.includes("1 收藏") && document.body.innerText.includes("0 历史") && document.body.innerText.includes("3 偏好");
        window.__importedProfileBackedUp = document.body.innerText.includes("已备份");
        window.__importedFavoriteTitle = state?.user?.favorites?.[0]?.title || "";
        window.__importedVolumeValue = document.querySelector("#volumeSlider")?.value || "";
        window.__importedRepeatTitle = document.querySelector("#repeatBtn")?.title || "";
        window.__profileBackupItemVisible = await waitForText("点击恢复");
        window.__profileBackupItemCount = document.querySelectorAll(".profile-backup-item").length;
        window.__profileBackupRefreshVisible = !document.querySelector("#refreshBackupsBtn")?.hidden;
        const importToast = Array.from(document.querySelectorAll(".toast")).find(toast => toast.innerText.includes("已导入本地资料"));
        importToast?.querySelector(".toast-action")?.click();
        window.__profileRestoreStatus = await waitForText("已恢复导入前资料");
        window.__restoredFavoriteGone = !state?.user?.favorites?.some(track => track.id === "smoke-ui-import");
      }
      })()
    `
  });
  await delay(650);

  const metrics = await cdp("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const body = document.body;
      const root = document.documentElement;
      const topbar = document.querySelector(".topbar");
      const nowCard = document.querySelector(".now-card");
      const transport = document.querySelector(".transport");
      const playButton = document.querySelector("#playBtn");
      const iconButtons = Array.from(document.querySelectorAll(".controls .icon-button"));
      const buttonSvgs = Array.from(document.querySelectorAll("button svg"));
      const toasts = Array.from(document.querySelectorAll(".toast"));
      const firstToastStyle = toasts[0] ? getComputedStyle(toasts[0]) : null;
      const toastContainer = document.querySelector(".toast-container");
      const toastRect = toastContainer?.getBoundingClientRect();
      const topbarRect = topbar?.getBoundingClientRect();
      const overflowTargets = Array.from(document.querySelectorAll(".transport, .queue-item, .profile-backup-item, .toast, .controls button, .utility-row button"));
      const overflowingElements = overflowTargets
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && (rect.left < -2 || rect.right > window.innerWidth + 2);
        })
        .slice(0, 5)
        .map(element => element.className || element.id || element.tagName);
      const bg = getComputedStyle(body).backgroundColor;
      const htmlBg = getComputedStyle(root).backgroundColor;
      const lightActive = document.querySelector('[data-theme="light"]')?.classList.contains("active") || false;
      const darkActive = document.querySelector('[data-theme="dark"]')?.classList.contains("active") || false;
      const inViewport = selector => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
      };
      return {
        title: document.querySelector("#trackTitle")?.textContent || "",
        service: document.querySelector("#serviceStatus")?.textContent || "",
        htmlLight: root.classList.contains("light"),
        bodyLight: body.classList.contains("light"),
        lightActive,
        darkActive,
        themeColor: document.querySelector("#themeColorMeta")?.getAttribute("content") || "",
        locationSearch: window.location.search,
        messageInputValue: document.querySelector("#messageInput")?.value || "",
        activeElementId: document.activeElement?.id || "",
        messageInputInViewport: inViewport("#messageInput"),
        queueSearchInViewport: inViewport("#queueSearch"),
        shortcutRecommendToast: document.body.innerText.includes("已准备好推荐音乐"),
        shortcutQueueToast: document.body.innerText.includes("已打开播放队列"),
        queuePanelCollapsed: document.querySelector("#queuePanel")?.classList.contains("collapsed") || false,
        topbarTop: topbar?.getBoundingClientRect().top ?? -1,
        nowCardTop: nowCard?.getBoundingClientRect().top ?? -1,
        transportWidth: transport?.getBoundingClientRect().width ?? 0,
        playButtonWidth: playButton?.getBoundingClientRect().width ?? 0,
        playButtonHeight: playButton?.getBoundingClientRect().height ?? 0,
        networkStatus: document.querySelector("#networkStatus")?.textContent || "",
        hasFetchTimeout: typeof fetchWithTimeout === "function" && typeof API_TIMEOUT_MS === "number",
        queueSearchValue: document.querySelector("#queueSearch")?.value || "",
        queueCountText: document.querySelector("#queueCount")?.textContent || "",
        queueClearHidden: document.querySelector("#clearQueueSearchBtn")?.hidden ?? true,
        firstQueueTitle: document.querySelector("#queueList strong")?.textContent || "",
        copiedTrackText: window.__copiedTrackText || "",
        copiedToastVisible: Boolean(window.__copiedTrackToastVisible),
        copiedQueueText: window.__copiedQueueText || "",
        copiedQueueToastVisible: Boolean(window.__copiedQueueToastVisible),
        libraryRefreshStatus: Boolean(window.__libraryRefreshStatus),
        libraryRefreshQueueText: window.__libraryRefreshQueueText || "",
        repeatPersistToastVisible: Boolean(window.__repeatPersistToastVisible),
        repeatPersistTitle: window.__repeatPersistTitle || "",
        repeatPersistExpectedTitle: window.__repeatPersistExpectedTitle || "",
        exportedProfileName: window.__profileExportName || "",
        exportedProfileHref: window.__profileExportHref || "",
        exportedProfileBlobType: window.__profileExportBlobType || "",
        exportedProfileRevoked: window.__profileExportRevoked || "",
        exportedProfileToastVisible: Boolean(window.__exportedProfileToastVisible),
        importedProfileStatus: Boolean(window.__importedProfileStatus),
        importedProfileSummary: Boolean(window.__importedProfileSummary),
        importedProfileBackedUp: Boolean(window.__importedProfileBackedUp),
        importedFavoriteTitle: window.__importedFavoriteTitle || "",
        profileRestoreStatus: Boolean(window.__profileRestoreStatus),
        restoredFavoriteGone: Boolean(window.__restoredFavoriteGone),
        importedVolumeValue: window.__importedVolumeValue || "",
        importedRepeatTitle: window.__importedRepeatTitle || "",
        profileBackupItemVisible: Boolean(window.__profileBackupItemVisible),
        profileBackupItemCount: Number(window.__profileBackupItemCount || 0),
        profileBackupRefreshVisible: Boolean(window.__profileBackupRefreshVisible),
        adminTokenRowHidden: document.querySelector("#adminTokenRow")?.hidden ?? false,
        adminTokenInputType: document.querySelector("#adminTokenInput")?.type || "",
        queueShortcutFocused: Boolean(window.__queueShortcutFocused),
        shortcutDialogOpen: Boolean(window.__shortcutDialogOpen),
        shortcutDialogRole: window.__shortcutDialogRole || "",
        shortcutDialogFocused: Boolean(window.__shortcutDialogFocused),
        shortcutTabTrapped: Boolean(window.__shortcutTabTrapped),
        shortcutShiftTabTrapped: Boolean(window.__shortcutShiftTabTrapped),
        shortcutFocusRestored: Boolean(window.__shortcutFocusRestored),
        toastCount: toasts.length,
        toastRolesValid: toasts.every(toast => ["status", "alert"].includes(toast.getAttribute("role"))),
        toastVisibleMs: toasts[0]?.style.getPropertyValue("--toast-visible-ms") || "",
        toastAnimationDelay: firstToastStyle?.animationDelay || "",
        toastOverlapsTopbar: Boolean(toastRect && topbarRect && toastRect.top < topbarRect.bottom && toastRect.bottom > topbarRect.top),
        toastBottomGap: toastRect ? Math.round(viewport.height - toastRect.bottom) : -1,
        overflowingElements,
        iconButtonMinSize: iconButtons.reduce((min, button) => {
          const rect = button.getBoundingClientRect();
          return Math.min(min, rect.width, rect.height);
        }, 999),
        buttonSvgsWithoutSize: buttonSvgs.filter(svg => !svg.hasAttribute("width") || !svg.hasAttribute("height")).length,
        buttonSvgsFocusable: buttonSvgs.filter(svg => svg.getAttribute("focusable") !== "false").length,
        scrollWidth: Math.max(body.scrollWidth, root.scrollWidth),
        clientWidth: root.clientWidth,
        background: bg,
        htmlBackground: htmlBg,
        bodyText: body.innerText.slice(0, 200)
      };
    })()`
  });

  await cdp("Runtime.evaluate", {
    expression: `document.querySelectorAll(".toast").forEach(toast => toast.remove())`
  });
  await delay(100);

  const { screenshot, screenshotMetrics } = await captureReliableScreenshot(viewport);
  const filePath = path.join(outDir, viewport.file);
  fs.writeFileSync(filePath, Buffer.from(screenshot.data, "base64"));

  return { filePath, metrics: metrics.result.value, screenshotMetrics };
}

function assertViewport(name, viewport, result) {
  const { filePath, metrics, screenshotMetrics } = result;
  const exerciseInteractions = viewport.exerciseInteractions !== false;
  const stat = fs.statSync(filePath);
  if (stat.size < viewport.minBytes) fail(`${name} screenshot looks too small (${stat.size} bytes).`);
  if (screenshotMetrics.width !== viewport.width || screenshotMetrics.height !== viewport.height) fail(`${name} screenshot has unexpected dimensions (${screenshotMetrics.width}x${screenshotMetrics.height}).`);
  if (screenshotMetrics.repeatedHalfSamples >= 2) fail(`${name} screenshot appears to contain repeated viewport tiles.`);
  if (!metrics.title || metrics.title === "载入中") fail(`${name} did not render a real track title.`);
  if (!metrics.service.includes("本地服务")) fail(`${name} did not render service health.`);
  if (!metrics.networkStatus.includes("在线")) fail(`${name} did not recover online network status.`);
  if (!metrics.hasFetchTimeout) fail(`${name} did not expose API timeout protection.`);
  if (exerciseInteractions) {
    if (metrics.queueSearchValue !== "太阳") fail(`${name} queue search input did not keep typed value.`);
    if (!metrics.queueCountText.includes("/")) fail(`${name} queue count did not show filtered results.`);
    if (metrics.queueClearHidden) fail(`${name} queue search clear button stayed hidden.`);
    if (!metrics.firstQueueTitle.includes("太阳")) fail(`${name} queue filter did not narrow visible tracks.`);
    if (!metrics.copiedTrackText.includes(metrics.title)) fail(`${name} did not copy the current track title.`);
    if (!metrics.copiedToastVisible) fail(`${name} did not show copy confirmation.`);
    if (!metrics.copiedQueueText.startsWith("1. ") || !metrics.copiedQueueText.includes("太阳")) fail(`${name} did not copy the filtered queue.`);
    if (!metrics.copiedQueueToastVisible) fail(`${name} did not show filtered queue copy confirmation.`);
    if (!metrics.libraryRefreshStatus) fail(`${name} did not show library refresh confirmation.`);
    if (!metrics.libraryRefreshQueueText.includes("/")) fail(`${name} library refresh did not preserve filtered queue count.`);
    if (!metrics.repeatPersistToastVisible || !metrics.repeatPersistTitle.includes(metrics.repeatPersistExpectedTitle)) fail(`${name} did not persist the repeat mode toggle.`);
    if (!metrics.exportedProfileName.startsWith("claudio-profile-") || !metrics.exportedProfileName.endsWith(".json")) fail(`${name} did not generate a profile export filename.`);
    if (!metrics.exportedProfileHref.includes("blob:claudio-profile-smoke")) fail(`${name} did not trigger a profile export download.`);
    if (!metrics.exportedProfileBlobType.includes("application/json")) fail(`${name} did not export profile as JSON.`);
    if (metrics.exportedProfileRevoked !== "blob:claudio-profile-smoke") fail(`${name} did not revoke the profile export URL.`);
    if (!metrics.exportedProfileToastVisible) fail(`${name} did not show profile export confirmation.`);
    if (!metrics.importedProfileStatus) fail(`${name} did not show profile import confirmation.`);
    if (!metrics.importedProfileSummary) fail(`${name} did not show profile import summary counts.`);
    if (!metrics.importedProfileBackedUp) fail(`${name} did not show profile import backup confirmation.`);
    if (metrics.importedFavoriteTitle !== "Smoke UI Import") fail(`${name} did not apply imported profile data.`);
    if (!metrics.profileRestoreStatus) fail(`${name} did not show profile restore confirmation.`);
    if (!metrics.restoredFavoriteGone) fail(`${name} did not restore the pre-import profile.`);
    if (Number(metrics.importedVolumeValue) !== 0.42) fail(`${name} did not apply imported profile settings.`);
    if (!metrics.importedRepeatTitle.includes("单曲循环")) fail(`${name} did not apply imported repeat mode setting.`);
    if (!metrics.profileBackupItemVisible || metrics.profileBackupItemCount < 1) fail(`${name} did not show the imported profile backup in the recent backups list.`);
    if (!metrics.profileBackupRefreshVisible) fail(`${name} did not expose the profile backup refresh control.`);
    if (!metrics.queueShortcutFocused) fail(`${name} slash shortcut did not focus queue search.`);
    if (!metrics.shortcutDialogOpen || metrics.shortcutDialogRole !== "dialog") fail(`${name} shortcut dialog did not open with dialog role.`);
    if (!metrics.shortcutDialogFocused) fail(`${name} shortcut dialog did not focus the close button.`);
    if (!metrics.shortcutTabTrapped || !metrics.shortcutShiftTabTrapped) fail(`${name} shortcut dialog did not trap Tab focus.`);
    if (!metrics.shortcutFocusRestored) fail(`${name} shortcut dialog did not restore focus.`);
    if (metrics.toastCount > 3) fail(`${name} shows too many stacked toasts (${metrics.toastCount}).`);
    if (!metrics.toastRolesValid) fail(`${name} toast roles are not accessible.`);
    if (!metrics.toastVisibleMs.endsWith("ms")) fail(`${name} toast visible duration is not set.`);
    if (!metrics.toastAnimationDelay.includes("s")) fail(`${name} toast animation delay was not computed.`);
  }
  if (metrics.toastOverlapsTopbar) fail(`${name} toasts overlap the topbar.`);
  if (metrics.toastBottomGap < 0) fail(`${name} toasts are below the viewport.`);
  if (metrics.overflowingElements?.length) fail(`${name} has clipped controls: ${metrics.overflowingElements.join(", ")}`);
  if (!metrics.adminTokenRowHidden) fail(`${name} shows admin token input during default local mode.`);
  if (metrics.adminTokenInputType !== "password") fail(`${name} admin token input is not password-protected.`);
  if (metrics.nowCardTop < 0 || metrics.nowCardTop > viewport.height - 120) fail(`${name} now card is not in the viewport.`);
  if (metrics.topbarTop < -2 || metrics.topbarTop > 40) fail(`${name} topbar is not aligned to the top.`);
  if (metrics.playButtonWidth < 48 || metrics.playButtonHeight < 48) fail(`${name} play button is too small (${metrics.playButtonWidth}x${metrics.playButtonHeight}).`);
  if (metrics.iconButtonMinSize < 38) fail(`${name} icon controls are too small (${metrics.iconButtonMinSize}px).`);
  if (metrics.buttonSvgsWithoutSize > 0) fail(`${name} has ${metrics.buttonSvgsWithoutSize} button SVGs without explicit dimensions.`);
  if (metrics.buttonSvgsFocusable > 0) fail(`${name} has ${metrics.buttonSvgsFocusable} decorative button SVGs in the focus order.`);
  if (metrics.scrollWidth > metrics.clientWidth + 2) fail(`${name} has horizontal overflow (${metrics.scrollWidth} > ${metrics.clientWidth}).`);
  if (metrics.background === "rgb(0, 0, 0)" && !metrics.bodyText.includes("Claudio")) fail(`${name} may be blank or black-screened.`);
}

function rgbLuminance(value) {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value || "");
  if (!match) return 0;
  return (Number(match[1]) * 0.2126) + (Number(match[2]) * 0.7152) + (Number(match[3]) * 0.0722);
}

function assertLightViewport(name, viewport, result) {
  assertViewport(name, viewport, result);
  const { metrics } = result;
  if (!metrics.htmlLight || !metrics.bodyLight) fail(`${name} did not apply light theme classes.`);
  if (!metrics.lightActive || metrics.darkActive) fail(`${name} did not activate the light theme control.`);
  if (metrics.themeColor !== "#ffffff") fail(`${name} did not sync the browser theme color.`);
  if (rgbLuminance(metrics.background) < 180 || rgbLuminance(metrics.htmlBackground) < 180) fail(`${name} background is not light enough.`);
}

function assertShortcutViewport(name, viewport, result, expected) {
  const { metrics } = result;
  const stat = fs.statSync(result.filePath);
  if (stat.size < viewport.minBytes) fail(`${name} screenshot looks too small (${stat.size} bytes).`);
  if (result.screenshotMetrics.width !== viewport.width || result.screenshotMetrics.height !== viewport.height) fail(`${name} screenshot has unexpected dimensions (${result.screenshotMetrics.width}x${result.screenshotMetrics.height}).`);
  if (result.screenshotMetrics.repeatedHalfSamples >= 2) fail(`${name} screenshot appears to contain repeated viewport tiles.`);
  if (metrics.locationSearch.includes("action=")) fail(`${name} did not clear the shortcut action from the URL.`);
  if (expected === "recommend") {
    if (metrics.messageInputValue !== "推荐几首适合现在的歌") fail(`${name} did not preload the recommendation prompt.`);
    if (metrics.activeElementId !== "messageInput") fail(`${name} did not focus the composer.`);
    if (!metrics.messageInputInViewport) fail(`${name} did not scroll the composer into view.`);
    if (!metrics.shortcutRecommendToast) fail(`${name} did not show recommendation shortcut feedback.`);
  }
  if (expected === "queue") {
    if (metrics.activeElementId !== "queueSearch") fail(`${name} did not focus queue search.`);
    if (!metrics.queueSearchInViewport) fail(`${name} did not scroll queue search into view.`);
    if (metrics.queuePanelCollapsed) fail(`${name} left the queue panel collapsed.`);
    if (!metrics.shortcutQueueToast) fail(`${name} did not show queue shortcut feedback.`);
  }
}

async function main() {
  if (typeof WebSocket === "undefined") throw new Error("Node.js 22+ is required for built-in WebSocket.");
  const edgePath = findEdge();
  if (!edgePath) throw new Error("Microsoft Edge was not found. Set EDGE_PATH to run UI smoke.");

  hadOriginalProfile = fs.existsSync(profilePath);
  if (hadOriginalProfile) originalProfile = fs.readFileSync(profilePath, "utf8");
  hadBackupDir = fs.existsSync(backupDir);
  originalBackups = snapshotDirectory(backupDir);

  fs.mkdirSync(outDir, { recursive: true });
  if (fs.existsSync(profileDir)) {
    await gracefullyCloseEdgeOnPort(cdpPort);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      await delay(1500);
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  }
  fs.mkdirSync(profileDir, { recursive: true });

  server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(startPort), CLAUDIO_SKIP_ENV: "1" },
    stdio: ["ignore", "ignore", "ignore"]
  });

  const { port } = await waitForHealth(server.pid);
  const url = `http://127.0.0.1:${port}/`;

  browser = spawn(edgePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "ignore"] });

  await waitForDevTools();

  const desktop = await captureViewport(url, {
    file: "claudio-desktop.png",
    width: 1440,
    height: 1100,
    mobile: false,
    minBytes: 120000
  });
  const mobile320 = await captureViewport(url, {
    file: "claudio-mobile-320.png",
    width: 320,
    height: 1100,
    mobile: true,
    minBytes: 50000,
    exerciseInteractions: false
  });
  const mobile375 = await captureViewport(url, {
    file: "claudio-mobile.png",
    width: 375,
    height: 1100,
    mobile: true,
    minBytes: 65000
  });
  const mobile414 = await captureViewport(url, {
    file: "claudio-mobile-414.png",
    width: 414,
    height: 1100,
    mobile: true,
    minBytes: 70000,
    exerciseInteractions: false
  });
  const lightDesktop = await captureViewport(url, {
    file: "claudio-light-desktop.png",
    width: 1440,
    height: 1100,
    mobile: false,
    minBytes: 110000,
    theme: "light",
    exerciseInteractions: false
  });
  const recommendShortcut = await captureViewport(`${url}?action=recommend`, {
    file: "claudio-shortcut-recommend.png",
    width: 1024,
    height: 760,
    mobile: false,
    minBytes: 90000,
    captureVisibleViewport: true,
    exerciseInteractions: false,
    shortcutExpect: "recommend"
  });
  const queueShortcut = await captureViewport(`${url}?action=queue`, {
    file: "claudio-shortcut-queue.png",
    width: 1024,
    height: 760,
    mobile: false,
    minBytes: 90000,
    captureVisibleViewport: true,
    exerciseInteractions: false,
    shortcutExpect: "queue"
  });

  assertViewport("desktop", { width: 1440, height: 1100, minBytes: 120000 }, desktop);
  assertViewport("mobile 320", { width: 320, height: 1100, minBytes: 50000, exerciseInteractions: false }, mobile320);
  assertViewport("mobile 375", { width: 375, height: 1100, minBytes: 65000 }, mobile375);
  assertViewport("mobile 414", { width: 414, height: 1100, minBytes: 70000, exerciseInteractions: false }, mobile414);
  assertLightViewport("light desktop", { width: 1440, height: 1100, minBytes: 110000, exerciseInteractions: false }, lightDesktop);
  assertShortcutViewport("recommend shortcut", { width: 1024, height: 760, minBytes: 90000 }, recommendShortcut, "recommend");
  assertShortcutViewport("queue shortcut", { width: 1024, height: 760, minBytes: 90000 }, queueShortcut, "queue");

  const screenshots = [desktop, mobile320, mobile375, mobile414, lightDesktop, recommendShortcut, queueShortcut]
    .map(result => `- ${result.filePath}`)
    .join("\n");

  if (failures.length) {
    console.error(`UI smoke failed:\n- ${failures.join("\n- ")}`);
    console.error(`Screenshots:\n${screenshots}`);
    process.exitCode = 1;
    return;
  }

  console.log("UI smoke checks passed.");
  console.log(`Screenshots:\n${screenshots}`);
}

async function cleanup() {
  await closeActiveTarget();
  await gracefullyCloseEdgeOnPort(cdpPort);
  if (browser && browser.exitCode === null) {
    browser.kill("SIGKILL");
    await delay(500);
    if (browser.exitCode === null) browser.kill("SIGKILL");
  }
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await delay(500);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  if (originalProfile !== null) {
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.writeFileSync(profilePath, originalProfile, "utf8");
  } else if (!hadOriginalProfile) {
    try {
      fs.rmSync(profilePath, { force: true });
    } catch {}
  }
  restoreDirectory(backupDir, originalBackups, hadBackupDir);
}

main()
  .catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(cleanup);
