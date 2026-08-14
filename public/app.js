const els = {
  body: document.body,
  clockMini: document.querySelector("#clockMini"),
  digitalClock: document.querySelector("#digitalClock"),
  dateText: document.querySelector("#dateText"),
  trackTitle: document.querySelector("#trackTitle"),
  trackArtist: document.querySelector("#trackArtist"),
  transportTitle: document.querySelector("#transportTitle"),
  transportState: document.querySelector("#transportState"),
  statusPill: document.querySelector("#statusPill"),
  serviceStatus: document.querySelector("#serviceStatus"),
  networkStatus: document.querySelector("#networkStatus"),
  cacheStatus: document.querySelector("#cacheStatus"),
  themeColorMeta: document.querySelector("#themeColorMeta"),
  installBtn: document.querySelector("#installBtn"),
  queueCount: document.querySelector("#queueCount"),
  nextCount: document.querySelector("#nextCount"),
  queueList: document.querySelector("#queueList"),
  queueSearch: document.querySelector("#queueSearch"),
  clearQueueSearchBtn: document.querySelector("#clearQueueSearchBtn"),
  coverArt: document.querySelector("#coverArt"),
  messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"),
  messageInput: document.querySelector("#messageInput"),
  chips: document.querySelector(".chips"),
  playBtn: document.querySelector("#playBtn"),
  playIcon: document.querySelector("#playIcon"),
  prevBtn: document.querySelector("#prevBtn"),
  nextBtn: document.querySelector("#nextBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  likeBtn: document.querySelector("#likeBtn"),
  hideQueueBtn: document.querySelector("#hideQueueBtn"),
  queuePanel: document.querySelector("#queuePanel"),
  progressSlider: document.querySelector("#progressSlider"),
  elapsedTime: document.querySelector("#elapsedTime"),
  durationTime: document.querySelector("#durationTime"),
  volumeSlider: document.querySelector("#volumeSlider"),
  libraryCount: document.querySelector("#libraryCount"),
  aiSettings: document.querySelector("#aiSettings"),
  deepseekKey: document.querySelector("#deepseekKey"),
  deepseekModel: document.querySelector("#deepseekModel"),
  deepseekBase: document.querySelector("#deepseekBase"),
  adminTokenRow: document.querySelector("#adminTokenRow"),
  adminTokenInput: document.querySelector("#adminTokenInput"),
  aiStatus: document.querySelector("#aiStatus"),
  clearAiBtn: document.querySelector("#clearAiBtn"),
  memorySettings: document.querySelector("#memorySettings"),
  memoryStatus: document.querySelector("#memoryStatus"),
  prefArtists: document.querySelector("#prefArtists"),
  prefGenres: document.querySelector("#prefGenres"),
  prefAvoid: document.querySelector("#prefAvoid"),
  smartRecommendBtn: document.querySelector("#smartRecommendBtn"),
  recentBtn: document.querySelector("#recentBtn"),
  favoritesBtn: document.querySelector("#favoritesBtn"),
  copyTrackBtn: document.querySelector("#copyTrackBtn"),
  refreshLibraryBtn: document.querySelector("#refreshLibraryBtn"),
  exportProfileBtn: document.querySelector("#exportProfileBtn"),
  importProfileBtn: document.querySelector("#importProfileBtn"),
  importProfileInput: document.querySelector("#importProfileInput"),
  refreshBackupsBtn: document.querySelector("#refreshBackupsBtn"),
  profileBackupList: document.querySelector("#profileBackupList"),
  charCount: document.querySelector("#charCount"),
  toastContainer: document.querySelector("#toastContainer"),
  shortcutOverlay: document.querySelector("#shortcutOverlay"),
  closeShortcutBtn: document.querySelector("#closeShortcutBtn"),
  loadingOverlay: document.querySelector("#loadingOverlay"),
  shuffleBtn: document.querySelector("#shuffleBtn"),
  repeatBtn: document.querySelector("#repeatBtn"),
  copyQueueBtn: document.querySelector("#copyQueueBtn"),
  clearQueueBtn: document.querySelector("#clearQueueBtn"),
  sleepTimer: document.querySelector("#sleepTimer"),
  sleepBtn: document.querySelector("#sleepBtn"),
  sleepOptions: document.querySelector("#sleepOptions"),
  sleepDuration: document.querySelector("#sleepDuration"),
  sleepRemaining: document.querySelector("#sleepRemaining")
};

let state = null;
let localElapsed = 0;
let deferredInstallPrompt = null;
let swRegistration = null;
let hasShownOfflineMessage = false;
let shuffleOn = false;
let repeatMode = 0;
let sleepUntil = null;
let sleepTicking = null;
let mediaFailureTrackId = null;
let lastClearedQueue = null;
let backendOriginHealthy = false;
let latestHealth = null;
let localOriginRecovery = null;
let isDraggingProgress = false;
let pauseElapsed = null;
let queueSearchTerm = "";
let shortcutReturnFocus = null;
let refreshingForServiceWorker = false;
let pendingShortcutAction = shortcutAction();
const QUEUE_RENDER_LIMIT = 80;
const STREAM_RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000];
const API_TIMEOUT_MS = 15000;
const MAX_TOASTS = 3;
const MAX_PROFILE_IMPORT_BYTES = 1024 * 1024;
const THEME_COLORS = {
  dark: "#05070b",
  light: "#ffffff"
};

function isDebugEnabled() {
  try {
    return new URLSearchParams(window.location.search).has("debug") || window.localStorage?.getItem("claudioDebug") === "1";
  } catch {
    return false;
  }
}

const debugOn = isDebugEnabled();

const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const LOCAL_LOOPBACK_PORTS = Array.from({ length: 11 }, (_, index) => 3000 + index);

function focusComposer() {
  els.messageInput.focus({ preventScroll: true });
}

function revealAndFocus(element) {
  if (!element) return;
  const scrollTarget = document.scrollingElement || document.documentElement;
  const rect = element.getBoundingClientRect();
  const targetTop = scrollTarget.scrollTop + rect.top - Math.max(16, (window.innerHeight - rect.height) / 2);
  scrollTarget.scrollTop = Math.max(0, targetTop);
  element.focus({ preventScroll: true });
}

function shortcutAction() {
  try {
    const action = new URLSearchParams(window.location.search).get("action");
    return ["recommend", "queue"].includes(action) ? action : "";
  } catch {
    return "";
  }
}

function clearShortcutAction() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("action")) return;
    url.searchParams.delete("action");
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, "", next || "/");
  } catch {}
}

function handleShortcutAction(action = shortcutAction()) {
  if (!action) return;
  if (action === "recommend") {
    els.messageInput.value = "推荐几首适合现在的歌";
    if (els.charCount) els.charCount.textContent = `${els.messageInput.value.length}/200`;
    revealAndFocus(els.messageInput);
    showToast("已准备好推荐音乐", "info");
  } else if (action === "queue") {
    els.queuePanel?.classList.remove("collapsed");
    if (els.hideQueueBtn) els.hideQueueBtn.textContent = "HIDE";
    revealAndFocus(els.queueSearch);
    showToast("已打开播放队列", "info");
  }
  pendingShortcutAction = "";
  clearShortcutAction();
}

function scheduleShortcutAction() {
  if (!pendingShortcutAction) return;
  const action = pendingShortcutAction;
  window.setTimeout(() => handleShortcutAction(action), 250);
}

const player = {
  el: new Audio(),
  requestId: 0,
  unlocked: false,
  active: false,
  trackId: null,
  sourceUrl: ""
};

player.el.preload = "auto";

const dateFmt = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short"
});

function pad(value) {
  return String(value).padStart(2, "0");
}

function clockStamp() {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function formatDuration(total = 0) {
  if (!Number.isFinite(total) || total <= 0) return "0:00";
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  return `${minutes}:${pad(seconds)}`;
}

function textElement(tagName, text, className = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = String(text ?? "");
  return element;
}

function safeCssUrl(url) {
  if (!url) return "";
  const str = String(url).trim();
  if (!str.startsWith("https://")) return "";
  if (/[()"'\\]/.test(str)) return "";
  return str.slice(0, 1000);
}

function playPath() {
  return '<path d="M8 5v14l11-7z"/>';
}

function pausePath() {
  return '<path d="M8 5h3v14H8zM13 5h3v14h-3z"/>';
}

function updateClock() {
  const now = new Date();
  const time = clockStamp();
  els.clockMini.textContent = time;
  els.digitalClock.textContent = time;
  els.dateText.textContent = dateFmt.format(now);
}

function providerLabel(track) {
  if (!track) return "WAITING";
  if (track.audioMode === "audius") return "AUDIUS FULL TRACK";
  if (track.audioMode === "deezer-preview") return "DEEZER PREVIEW";
  if (track.audioMode === "itunes-preview") return "ITUNES PREVIEW";
  if (track.audioMode === "file") return "LOCAL FILE";
  if (track.audioMode === "radio") return "RADIO FALLBACK";
  return "NO PLAYABLE AUDIO";
}

function applyVolume() {
  const value = Math.max(0, Math.min(1, Number(els.volumeSlider.value || 0.68)));
  player.el.volume = value;
  updateSliderFill(els.volumeSlider, value * 100);
}

function updateSliderFill(slider, pct) {
  slider.style.background = `linear-gradient(90deg, #8b5cf6 0%, #ec4899 ${pct}%, rgba(255,255,255,0.1) ${pct}%, rgba(255,255,255,0.1) 100%)`;
}

function isLoopbackHost() {
  return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
}

async function probeLocalPort(port, timeoutMs = 350) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${window.location.protocol}//${window.location.hostname}:${port}/api/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok && payload.app === "ClaudioMusic";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function recoverLocalOrigin() {
  if (!isLoopbackHost()) return null;
  if (localOriginRecovery) return localOriginRecovery;

  localOriginRecovery = (async () => {
    try {
      const current = await fetch("/api/health", { cache: "no-store" });
      if (current.ok) {
        backendOriginHealthy = true;
        return window.location.origin;
      }
    } catch {}

    const currentPort = Number(window.location.port || (window.location.protocol === "https:" ? 443 : 80));
    for (const port of LOCAL_LOOPBACK_PORTS) {
      if (port === currentPort) continue;
      if (await probeLocalPort(port)) {
        const target = `${window.location.protocol}//${window.location.hostname}:${port}${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.replace(target);
        return target;
      }
    }
    return null;
  })().finally(() => {
    localOriginRecovery = null;
  });

  return localOriginRecovery;
}

async function fetchWithTimeout(path, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(path, {
      ...options,
      signal: options.signal || controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function api(path, options = {}, retries = 2) {
  const method = String(options.method || "GET").toUpperCase();
  const canRetry = method === "GET" || method === "HEAD";
  let lastError;
  if (isLoopbackHost() && !backendOriginHealthy) {
    await recoverLocalOrigin();
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(payload.error || "服务暂时不可用，请稍后再试。");
        error.status = res.status;
        error.code = payload.code;
        error.fields = payload.fields;
        throw error;
      }
      backendOriginHealthy = true;
      return payload;
    } catch (error) {
      lastError = error;
      if (error.name === "AbortError") {
        const timeoutError = new Error("请求超时了，请稍后再试。");
        timeoutError.code = "CLIENT_TIMEOUT";
        throw timeoutError;
      }
      if (error.name === "TypeError") {
        backendOriginHealthy = false;
      }
      if (error.name === "TypeError" && !canRetry) {
        throw new Error("本地服务未连接。请先启动 Claudio Music 后端，再刷新页面。");
      }
      const shouldRetry = canRetry && attempt < retries && (
        error.name === "TypeError" ||
        [502, 503, 504].includes(error.status) ||
        error.code === "UPSTREAM_TIMEOUT"
      );
      if (shouldRetry) {
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("网络连接不稳定，请稍后再试。");
}

function unlockAudio() {
  player.unlocked = true;
  applyVolume();
}

function isSameTrack(track) {
  return track?.id && player.trackId === track.id && player.sourceUrl === track.audioUrl;
}

function isRadio(track) {
  return track?.audioMode === "radio";
}

function friendlyAudioError(error) {
  if (error?.name === "NotAllowedError") return "浏览器还没有允许播放，请再点一次播放或发送一条点歌消息。";
  if (error?.name === "NotSupportedError") return "这个音频地址当前浏览器不支持，已保留队列，可以换一首。";
  if (error?.message) return error.message;
  return "未知播放错误";
}

function validationSummary(error) {
  if (!error?.fields) return error?.message || "请求参数无效。";
  const details = Object.entries(error.fields).map(([field, message]) => `${field}: ${message}`).join("\n");
  return `${error.message}\n${details}`;
}

function showSystemMessage(text) {
  if (!state) return;
  const messages = Array.isArray(state.messages) ? state.messages.slice() : [];
  messages.push({ role: "ai", at: clockStamp(), text });
  state = { ...state, messages };
  renderMessages(messages);
}

function showToast(text, type = "info", action) {
  if (!els.toastContainer) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  const message = document.createElement("span");
  message.textContent = text;
  toast.appendChild(message);
  if (action?.label && typeof action.onClick === "function") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      action.onClick();
      if (toast.parentNode) toast.remove();
    });
    toast.appendChild(button);
  }
  els.toastContainer.appendChild(toast);
  while (els.toastContainer.children.length > MAX_TOASTS) {
    els.toastContainer.firstElementChild?.remove();
  }
  const timeout = Math.min(9000, Math.max(4100, String(text).length * 80));
  toast.style.setProperty("--toast-visible-ms", `${Math.max(0, timeout - 300)}ms`);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, timeout);
}

function profile() {
  return state?.user || {};
}

function isCurrentFavorite() {
  return Boolean(state?.now?.id && profile().favoriteIds?.includes(state.now.id));
}

function currentTrackShareText(track = state?.now) {
  if (!track) return "";
  const source = track.permalink || track.audioUrl || "";
  const suffix = source ? `\n${source}` : "";
  return `${track.title || "未知歌曲"} - ${track.artist || "未知歌手"}${suffix}`;
}

async function writeClipboardText(text) {
  if (!navigator.clipboard?.writeText) {
    throw new Error("当前浏览器不支持剪贴板复制");
  }
  await navigator.clipboard.writeText(text);
}

async function copyCurrentTrack() {
  const text = currentTrackShareText();
  if (!text) {
    showToast("还没有正在播放的歌曲", "warning");
    return;
  }
  await writeClipboardText(text);
  showToast("已复制当前歌曲", "success");
}

function updateLikeUi() {
  const active = isCurrentFavorite();
  els.likeBtn.classList.toggle("active", active);
  els.likeBtn.title = active ? "取消收藏" : "收藏当前歌曲";
  els.likeBtn.setAttribute("aria-label", active ? "取消收藏当前歌曲" : "收藏当前歌曲");
}

function renderAiStatus(ai) {
  if (!els.aiStatus) return;
  const enabled = Boolean(ai?.enabled);
  els.aiStatus.textContent = enabled ? `已连接 · ${ai.model || "DeepSeek"}` : "未连接";
  els.aiStatus.classList.toggle("connected", enabled);
  if (els.adminTokenRow) els.adminTokenRow.hidden = !ai?.adminTokenRequired;
  if (els.deepseekModel && ai?.model) els.deepseekModel.value = ai.model;
  if (els.deepseekBase && ai?.apiBase) els.deepseekBase.value = ai.apiBase;
}

function adminTokenHeaders() {
  const token = els.adminTokenInput?.value.trim();
  return token ? { "X-Claudio-Token": token } : {};
}

function setChip(el, text, tone = "") {
  if (!el) return;
  el.textContent = text;
  el.classList.remove("online", "warning", "offline");
  if (tone) el.classList.add(tone);
}

function updateNetworkStatus(announce = false) {
  const online = navigator.onLine !== false;
  setChip(els.networkStatus, online ? "在线" : "离线", online ? "online" : "offline");
  if (!state || !announce) return;
  if (online) {
    if (hasShownOfflineMessage) showSystemMessage("网络已恢复，可以继续搜索真实音乐源。");
    hasShownOfflineMessage = false;
  } else {
    hasShownOfflineMessage = true;
    showSystemMessage("当前处于离线状态。已缓存的界面仍可打开，在线音乐搜索会暂时不可用。");
  }
}

function updateInstallStatus(text, tone = "") {
  if (!els.installBtn) return;
  els.installBtn.textContent = text;
  els.installBtn.classList.remove("online", "warning", "offline");
  if (tone) els.installBtn.classList.add(tone);
}

function renderInstallStatus() {
  if (!els.installBtn) return;
  if (isStandalone) {
    els.installBtn.hidden = false;
    els.installBtn.disabled = true;
    updateInstallStatus("已安装", "online");
    return;
  }
  if (deferredInstallPrompt) {
    els.installBtn.hidden = false;
    els.installBtn.disabled = false;
    updateInstallStatus("安装应用", "online");
    return;
  }
  els.installBtn.hidden = false;
  els.installBtn.disabled = true;
  updateInstallStatus("浏览器运行", "");
}

function formatServiceHealth(health) {
  if (!health?.ok) return "服务异常";
  const queueText = Number.isFinite(health.queueSize) ? ` · ${health.queueSize} 首` : "";
  const versionText = health.frontendVersion ? ` · v${String(health.frontendVersion).split(".")[0]}` : "";
  return `本地服务${queueText}${versionText}`;
}

function renderServiceHealth(health, tone = "online") {
  latestHealth = health || latestHealth;
  setChip(els.serviceStatus, formatServiceHealth(latestHealth), tone);
  if (latestHealth?.frontendVersion) {
    els.serviceStatus.title = `Claudio ${latestHealth.frontendVersion}`;
  }
}

async function refreshServiceHealth() {
  try {
    const health = await api("/api/health", {}, 1);
    renderServiceHealth(health, "online");
    return health;
  } catch (error) {
    setChip(els.serviceStatus, "服务未连接", "offline");
    els.serviceStatus.title = error.message || "无法连接本地服务";
    throw error;
  }
}

function updateCacheStatus(text, tone = "") {
  setChip(els.cacheStatus, text, tone);
}

function applyTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.classList.toggle("light", nextTheme === "light");
  els.body.classList.toggle("light", nextTheme === "light");
  document.querySelectorAll(".theme-choice").forEach(button => {
    button.classList.toggle("active", button.dataset.theme === nextTheme);
  });
  if (els.themeColorMeta) els.themeColorMeta.setAttribute("content", THEME_COLORS[nextTheme]);
}

function applyServiceWorkerUpdate(worker = swRegistration?.waiting) {
  if (!worker) return;
  refreshingForServiceWorker = true;
  updateCacheStatus("正在切换新版", "warning");
  worker.postMessage({ type: "SKIP_WAITING" });
}

function promptServiceWorkerRefresh(message) {
  updateCacheStatus("刷新可更新", "warning");
  showToast(message, "info", {
    label: "刷新",
    onClick: () => applyServiceWorkerUpdate()
  });
  showSystemMessage(message);
}

function renderMemory(profileData = profile()) {
  const settings = profileData.settings || {};
  const preferences = profileData.preferences || {};
  const favorites = profileData.favorites || [];
  const history = profileData.history || [];

  if (els.prefArtists && document.activeElement !== els.prefArtists) {
    els.prefArtists.value = (preferences.artists || []).join(", ");
  }
  if (els.prefGenres && document.activeElement !== els.prefGenres) {
    els.prefGenres.value = (preferences.genres || []).join(", ");
  }
  if (els.prefAvoid && document.activeElement !== els.prefAvoid) {
    els.prefAvoid.value = (preferences.avoid || []).join(", ");
  }
  if (els.memoryStatus) {
    els.memoryStatus.textContent = `${favorites.length} 收藏 · ${history.length} 最近`;
  }

  applyTheme(settings.theme);
  if (typeof settings.volume === "number") {
    els.volumeSlider.value = settings.volume;
    applyVolume();
  }
  if (Number.isInteger(settings.repeatMode)) {
    repeatMode = Math.max(0, Math.min(2, settings.repeatMode));
    updateRepeatUi();
  }
}

function stopAudio() {
  if (player.active && Number.isFinite(player.el.currentTime) && player.el.currentTime > 0) {
    pauseElapsed = player.el.currentTime;
    localElapsed = pauseElapsed;
  }
  player.requestId += 1;
  player.el.pause();
  player.active = false;
  updatePlaybackUi();
}

async function rememberHistory(track, context = "play") {
  if (!track?.id) return;
  try {
    const data = await api("/api/user/history", {
      method: "POST",
      body: JSON.stringify({ track, context })
    });
    if (state && data.profile) {
      state = { ...state, user: data.profile };
      renderMemory(data.profile);
    }
  } catch {
    // History should never interrupt playback.
  }
}

async function handlePlaybackFailure(message) {
  const failedId = state?.now?.id || player.trackId;
  if (!failedId || mediaFailureTrackId === failedId) {
    showSystemMessage(message);
    return;
  }
  mediaFailureTrackId = failedId;
  player.active = false;
  updatePlaybackUi();
  if (state?.queue?.length > 1) {
    showSystemMessage(`${message} 已自动尝试下一首。`);
    try {
      await nextTrack(true);
    } catch (error) {
      showSystemMessage(error.message || "自动切换下一首失败。可以手动选择其他歌曲。");
    }
    return;
  }
  showSystemMessage(`${message} 可以换一个歌名、歌手或风格，或者把自己的音乐文件放进 music 文件夹。`);
}

async function startAudio(track, options = {}) {
  const { force = false, context = "play" } = options;
  if (!track?.audioUrl) {
    player.active = false;
    updatePlaybackUi();
    showSystemMessage("这首歌没有可播放地址。请换个歌名、风格，或把你自己的音乐文件放进 music 文件夹。");
    return;
  }

  unlockAudio();

  if (!force && player.active && !player.el.paused && isSameTrack(track)) return;

  const requestId = ++player.requestId;
  const sourceChanged = player.sourceUrl !== track.audioUrl;

  if (sourceChanged) {
    player.el.pause();
    player.el.src = track.audioUrl;
    player.sourceUrl = track.audioUrl;
  }

  player.trackId = track.id;

  const resumeFrom = (pauseElapsed !== null) ? pauseElapsed : localElapsed;
  if (!isRadio(track) && Number.isFinite(resumeFrom) && resumeFrom > 0) {
    try {
      player.el.currentTime = Math.min(resumeFrom, Math.max(0, (track.duration || 1) - 1));
    } catch {
      // Some remote streams only become seekable after metadata is loaded.
    }
  }
  pauseElapsed = null;

  applyVolume();
  updatePlaybackUi("LOADING");

  try {
    await player.el.play();
    if (requestId !== player.requestId) return;
    mediaFailureTrackId = null;
    player.active = true;
    updatePlaybackUi();
    rememberHistory(track, context);
  } catch (error) {
    if (requestId !== player.requestId || error?.name === "AbortError") return;
    await handlePlaybackFailure(`没有开始播放：${friendlyAudioError(error)}`);
  }
}

function playbackState(override) {
  if (override) return override;
  if (!state?.now) return "WAITING";
  if (player.active && !player.el.paused && player.trackId === state.now.id) return "PLAYING";
  if (state.status === "ON AIR") return player.unlocked ? "READY" : "READY";
  return "PAUSED";
}

function updatePlaybackUi(override) {
  const track = state?.now;
  const label = playbackState(override);
  const playing = label === "PLAYING";

  els.statusPill.textContent = label;
  els.playIcon.innerHTML = playing ? pausePath() : playPath();
  els.transportState.textContent = `${label} · ${providerLabel(track)}`;
  els.body.classList.toggle("paused", !playing);
  updateLikeUi();
}

function renderMessage(message) {
  const wrapper = document.createElement("article");
  wrapper.className = `message ${message.role === "user" ? "user" : "ai"}`;
  wrapper.append(
    textElement("span", `${message.role === "user" ? "你" : "Claudio"} ${message.at}`, "meta"),
    textElement("div", message.text, "bubble")
  );
  return wrapper;
}

function renderMessages(messages) {
  els.messages.replaceChildren();
  (messages || []).forEach(message => els.messages.appendChild(renderMessage(message)));
  els.messages.scrollTop = els.messages.scrollHeight;
}

function normalizedQueue(data) {
  const queue = data.queue || [];
  return queue.map((track, index) => ({ ...track, index }));
}

function queueSearchText(track) {
  return [
    track.title,
    track.artist,
    track.source,
    track.note,
    track.genre,
    track.audioMode
  ].filter(Boolean).join(" ").toLowerCase();
}

function queueInfoItem(marker, title, detail, time, extraClass = "") {
  const item = document.createElement("li");
  item.className = ["queue-item", extraClass].filter(Boolean).join(" ");
  const text = document.createElement("span");
  text.append(textElement("strong", title), document.createTextNode(` ${detail}`));
  item.append(
    textElement("span", marker, "marker"),
    text,
    textElement("time", time)
  );
  return item;
}

function queueTrackText(track, sourceLabel) {
  const text = document.createElement("span");
  text.append(textElement("strong", track.title), document.createTextNode(` - ${track.artist || ""}`));
  if (sourceLabel) {
    text.append(document.createTextNode(" "), textElement("small", sourceLabel));
  }
  return text;
}

function renderQueue(queue, currentId) {
  const query = queueSearchTerm.trim().toLowerCase();
  const filteredQueue = query ? queue.filter(track => queueSearchText(track).includes(query)) : queue;
  const visibleQueue = filteredQueue.slice(0, QUEUE_RENDER_LIMIT);
  const signature = `${queue.length}:${filteredQueue.length}:${query}:${visibleQueue.map(track => `${track.id}:${track.favorite ? 1 : 0}:${track.id === currentId ? 1 : 0}`).join("|")}`;
  if (els.queueList.dataset.signature === signature) return;
  els.queueList.dataset.signature = signature;
  els.queueList.replaceChildren();

  if (!queue.length) {
    const empty = queueInfoItem("+", "还没有歌曲", "发送一句“推荐几首适合现在的歌”开始", "0:00");
    els.queueList.appendChild(empty);
    return;
  }

  if (!filteredQueue.length) {
    const empty = queueInfoItem("?", "没有匹配的歌曲", `试试歌手、来源，或清除筛选查看全部 ${queue.length} 首`, queue.length, "queue-more");
    els.queueList.appendChild(empty);
    return;
  }

  visibleQueue.forEach(track => {
    const item = document.createElement("li");
    item.className = "queue-item";
    item.tabIndex = 0;
    item.role = "button";
    const sourceLabel = track.source === "audius" ? "Audius" : track.source === "deezer" ? "Deezer" : track.source === "itunes" ? "iTunes" : track.source === "local" ? "本地" : track.source === "radio-browser" ? "电台" : "";
    const canRemove = track.source !== "local";
    item.append(
      textElement("span", track.id === currentId ? "▶" : track.favorite ? "♥" : "·", "marker"),
      queueTrackText(track, sourceLabel),
      textElement("time", formatDuration(track.duration))
    );
    if (canRemove) {
      const remove = textElement("button", "×", "remove-btn");
      remove.type = "button";
      remove.title = "从队列移除";
      remove.setAttribute("aria-label", `移除 ${track.title || "这首歌曲"}`);
      item.appendChild(remove);
    }
    item.addEventListener("click", event => {
      if (event.target.closest(".remove-btn")) return;
      playIndex(track.index, true);
    });
    item.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        if (event.target.closest(".remove-btn")) return;
        event.preventDefault();
        playIndex(track.index, true);
      }
    });
    const removeBtn = item.querySelector(".remove-btn");
    if (removeBtn) {
      removeBtn.addEventListener("click", event => {
        event.stopPropagation();
        removeFromQueue(track.index, track.id);
      });
    }
    els.queueList.appendChild(item);
  });

  if (filteredQueue.length > visibleQueue.length) {
    const more = queueInfoItem(
      "…",
      `还有 ${filteredQueue.length - visibleQueue.length} 首未显示`,
      `${query ? "筛选结果" : "队列"}过长时仅渲染前 ${QUEUE_RENDER_LIMIT} 首以保持流畅`,
      filteredQueue.length,
      "queue-more"
    );
    els.queueList.appendChild(more);
  }
}

function renderCover(track) {
  els.coverArt.className = `cover source-${track?.source || "local"}`;
  const safeUrl = safeCssUrl(track?.artwork);
  if (safeUrl) {
    els.coverArt.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.12)), url("${safeUrl}")`;
    els.coverArt.classList.add("has-artwork");
  } else {
    els.coverArt.style.backgroundImage = "";
    els.coverArt.classList.remove("has-artwork");
  }
}

function render(data) {
  const previousTrackId = state?.now?.id;
  state = data;

  const track = data.now;
  const queue = normalizedQueue(data);
  const trackChanged = previousTrackId !== track?.id;
  if (trackChanged) pauseElapsed = null;
  if ((!player.active && pauseElapsed === null) || trackChanged) localElapsed = data.elapsed || 0;

  els.trackTitle.textContent = track?.title || "告诉 Claudio 你想听什么";
  els.trackArtist.textContent = track?.artist || "输入心情、歌名、歌手或风格，我会推荐并播放真实音乐。";
  els.transportTitle.textContent = track ? `${track.title} - ${track.artist}` : "等待点歌";
  const filteredCount = queueSearchTerm.trim() ? queue.filter(item => queueSearchText(item).includes(queueSearchTerm.trim().toLowerCase())).length : queue.length;
  els.queueCount.textContent = queueSearchTerm.trim() ? `${filteredCount}/${queue.length} 首` : `${queue.length} 首`;
  els.nextCount.textContent = queueSearchTerm.trim() ? `匹配 ${filteredCount} 首` : `${Math.max(0, queue.length - 1)} 首`;
  els.libraryCount.textContent = queue.length;
  els.volumeSlider.value = data.volume ?? 0.68;
  updateSliderFill(els.volumeSlider, (data.volume ?? 0.68) * 100);
  els.durationTime.textContent = formatDuration(track?.duration || 0);

  renderAiStatus(data.ai);
  renderMemory(data.user);
  renderCover(track);
  renderQueue(queue, track?.id);
  renderMessages(data.messages || []);
  updateProgress();
  updatePlaybackUi();
  updateMediaSession(track);
}

function updateProgress() {
  if (!state?.now) {
    els.elapsedTime.textContent = "0:00";
    els.progressSlider.value = "0";
    updateSliderFill(els.progressSlider, 0);
    return;
  }

  if (isDraggingProgress) return;

  const isPlayingCurrent = player.active && !player.el.paused && player.trackId === state.now.id;
  const current = isPlayingCurrent ? player.el.currentTime : localElapsed;
  const realDuration = isPlayingCurrent && Number.isFinite(player.el.duration) && player.el.duration > 0
    ? player.el.duration
    : state.now.duration || 1;
  const duration = Math.max(1, realDuration);

  els.elapsedTime.textContent = formatDuration(current);
  els.durationTime.textContent = formatDuration(duration);
  const pct = Math.min(100, Math.max(0, (current / duration) * 100));
  els.progressSlider.value = String(pct);
  updateSliderFill(els.progressSlider, pct);
}

async function refresh() {
  try {
    render(await api("/api/now"));
  } catch (error) {
    els.trackTitle.textContent = "服务未启动";
    els.trackArtist.textContent = error.message;
    throw error;
  }
}

async function refreshAiStatus() {
  const data = await api("/api/ai/status");
  renderAiStatus(data.ai);
  return data.ai;
}

async function saveAiConfig() {
  const apiKey = els.deepseekKey.value.trim();
  const model = els.deepseekModel.value.trim() || "deepseek-v4-flash";
  const apiBase = els.deepseekBase.value.trim() || "https://api.deepseek.com";
  const data = await api("/api/ai/config", {
    method: "POST",
    headers: adminTokenHeaders(),
    body: JSON.stringify({ apiKey, model, apiBase })
  });
  els.deepseekKey.value = "";
  if (els.adminTokenInput) els.adminTokenInput.value = "";
  renderAiStatus(data.ai);
  showSystemMessage(`DeepSeek 已连接：${data.ai.model}`);
}

async function clearAiConfig() {
  const data = await api("/api/ai/clear", { method: "POST", headers: adminTokenHeaders(), body: JSON.stringify({}) });
  els.deepseekKey.value = "";
  if (els.adminTokenInput) els.adminTokenInput.value = "";
  renderAiStatus(data.ai);
  showSystemMessage("DeepSeek Key 已清除，已切回本地规则。");
}

async function savePreferences() {
  const data = await api("/api/user/preferences", {
    method: "POST",
    body: JSON.stringify({
      replace: true,
      artists: els.prefArtists.value,
      genres: els.prefGenres.value,
      avoid: els.prefAvoid.value
    })
  });
  if (state) state = { ...state, user: data.profile };
  renderMemory(data.profile);
  showSystemMessage("偏好已保存，之后推荐会优先参考这些歌手和风格。");
}

async function saveSettings(settings) {
  try {
    const data = await api("/api/user/settings", {
      method: "POST",
      body: JSON.stringify(settings)
    });
    if (state) state = { ...state, user: data.profile, volume: data.settings?.volume ?? state.volume };
    renderMemory(data.profile);
  } catch (error) {
    showSystemMessage(validationSummary(error));
  }
}

async function playIndex(index, forceAudio = false) {
  const data = await api("/api/play", {
    method: "POST",
    body: JSON.stringify({ index, playing: true })
  });
  render(data);
  await startAudio(data.now, { force: forceAudio, context: "queue" });
}

async function playSavedTrack(track, context) {
  if (!track?.id) return;
  unlockAudio();
  const data = await api("/api/play", {
    method: "POST",
    body: JSON.stringify({ track, playing: true, context })
  });
  render(data);
  await startAudio(data.now, { force: true, context });
}

async function setPlaying(playing) {
  const data = await api("/api/play", {
    method: "POST",
    body: JSON.stringify({ playing })
  });
  render(data);
  if (playing) await startAudio(data.now, { force: true, context: "play" });
  else stopAudio();
}

async function nextTrack(forceAudio = true) {
  if (!state?.queue?.length) return recommend("推荐几首适合现在的歌");
  let data = await api("/api/next", { method: "POST", body: JSON.stringify({}) });
  if (forceAudio && data.now && data.status !== "ON AIR") {
    data = await api("/api/play", {
      method: "POST",
      body: JSON.stringify({ playing: true })
    });
  }
  render(data);
  if (data.status === "ON AIR") await startAudio(data.now, { force: true, context: "next" });
}

async function previousTrack() {
  if (!state?.queue?.length) return recommend("推荐几首适合现在的歌");
  let data = await api("/api/previous", { method: "POST", body: JSON.stringify({}) });
  if (data.now && data.status !== "ON AIR") {
    data = await api("/api/play", {
      method: "POST",
      body: JSON.stringify({ playing: true })
    });
  }
  render(data);
  if (data.status === "ON AIR") await startAudio(data.now, { force: true, context: "previous" });
}

async function recommend(message = "推荐几首适合现在的歌") {
  setBusy(true);
  try {
    unlockAudio();
    updatePlaybackUi("LOADING");
    setLoadingPhase("正在解析意图...");
    const data = await api("/api/music/recommend", {
      method: "POST",
      body: JSON.stringify({ message })
    });
    setLoadingPhase("正在准备播放...");
    render(data);
    await startAudio(data.now, { force: true, context: `recommend: ${message}` });
  } catch (error) {
    updatePlaybackUi();
    throw error;
  } finally {
    setLoadingPhase(null);
    setBusy(false);
    focusComposer();
  }
}

async function sendMessage(message) {
  setBusy(true);
  try {
    unlockAudio();
    updatePlaybackUi("LOADING");
    const data = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message })
    });
    render(data);
    if (data.now && data.status === "ON AIR") await startAudio(data.now, { force: true, context: `chat: ${message}` });
  } catch (error) {
    updatePlaybackUi();
    throw error;
  } finally {
    setBusy(false);
    focusComposer();
  }
}

function setBusy(isBusy) {
  els.messageInput.disabled = isBusy;
  els.composer.querySelector("button").disabled = isBusy;
  els.chips.querySelectorAll("button").forEach(button => {
    button.disabled = isBusy;
  });
  [els.smartRecommendBtn, els.recentBtn, els.favoritesBtn, els.copyTrackBtn, els.refreshLibraryBtn, els.exportProfileBtn, els.importProfileBtn, els.copyQueueBtn].forEach(button => {
    if (button) button.disabled = isBusy;
  });
  if (els.loadingOverlay) {
    if (isBusy) els.loadingOverlay.removeAttribute("hidden");
    else els.loadingOverlay.setAttribute("hidden", "");
  }
}

function setLoading(isLoading, text = "") {
  if (!els.loadingOverlay) return;
  if (isLoading) {
    els.loadingOverlay.removeAttribute("hidden");
    setLoadingPhase(text);
  } else {
    setLoadingPhase(null);
    els.loadingOverlay.setAttribute("hidden", "");
  }
}

function setLoadingPhase(text) {
  if (!els.loadingOverlay) return;
  const existing = els.loadingOverlay.querySelector(".loading-text");
  if (text) {
    if (existing) existing.textContent = text;
    else {
      const span = document.createElement("span");
      span.className = "loading-text";
      span.textContent = text;
      els.loadingOverlay.appendChild(span);
    }
  } else if (existing) existing.remove();
}

function listSavedTracks(title, tracks, emptyText, context) {
  if (!tracks?.length) {
    showSystemMessage(emptyText);
    return;
  }
  showSystemMessage(`${title}：\n\n${tracks.slice(0, 8).map((track, index) => `${index + 1}. ${track.title} - ${track.artist}`).join("\n")}`);
  playSavedTrack(tracks[0], context).catch(error => showSystemMessage(error.message));
}

function queueForSharing() {
  const queue = normalizedQueue(state || {});
  const query = queueSearchTerm.trim().toLowerCase();
  return query ? queue.filter(track => queueSearchText(track).includes(query)) : queue;
}

function queueShareText(queue = queueForSharing()) {
  return queue.map((track, index) => `${index + 1}. ${currentTrackShareText(track).replace(/\n/g, " ")}`).join("\n");
}

async function copyQueue() {
  const queue = queueForSharing();
  if (!queue.length) {
    showToast(queueSearchTerm.trim() ? "当前筛选没有可复制的歌曲" : "队列为空，先添加几首歌", "warning");
    return;
  }
  await writeClipboardText(queueShareText(queue));
  showToast(queueSearchTerm.trim() ? `已复制筛选队列 · ${queue.length} 首` : `已复制播放队列 · ${queue.length} 首`, "success");
}

async function refreshLibrary() {
  setLoading(true, "正在刷新曲库...");
  try {
    const data = await api("/api/library/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    render(data);
    const localFiles = Number(data.library?.localFiles || 0);
    const queueSize = Number(data.library?.queueSize || data.queue?.length || 0);
    showToast(`曲库已刷新 · 本地 ${localFiles} 首 · 队列 ${queueSize} 首`, "success");
  } finally {
    setLoading(false);
  }
}

function profileExportFilename(date = new Date()) {
  const stamp = date.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `claudio-profile-${stamp}.json`;
}

function profileImportSummaryText(summary = {}, backupPath = "") {
  const favorites = Number(summary.favorites || 0);
  const history = Number(summary.history || 0);
  const preferences = Number(summary.preferenceItems || 0);
  const backup = backupPath ? " · 已备份" : "";
  return `已导入本地资料 · ${favorites} 收藏 · ${history} 历史 · ${preferences} 偏好${backup}`;
}

function formatBackupLabel(backup) {
  const date = new Date(backup.createdAt || "");
  const when = Number.isNaN(date.getTime())
    ? "未知时间"
    : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const size = Number(backup.size || 0);
  const sizeText = size > 0 ? `${Math.max(1, Math.round(size / 1024))} KB` : "";
  return sizeText ? `${when} · ${sizeText}` : when;
}

function renderProfileBackups(backups = []) {
  if (!els.profileBackupList) return;
  els.profileBackupList.replaceChildren();
  if (!backups.length) {
    const empty = document.createElement("p");
    empty.textContent = "暂无导入前备份";
    els.profileBackupList.appendChild(empty);
    return;
  }
  backups.forEach(backup => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "profile-backup-item";
    item.dataset.backupPath = backup.backupPath || "";
    item.title = "恢复这份导入前资料";
    const name = document.createElement("strong");
    name.textContent = formatBackupLabel(backup);
    const path = document.createElement("span");
    path.textContent = "点击恢复";
    item.append(name, path);
    item.setAttribute("aria-label", `恢复 ${name.textContent} 的导入前资料`);
    item.addEventListener("click", () => restoreProfileBackup(backup.backupPath).catch(error => showToast(validationSummary(error), "error")));
    els.profileBackupList.appendChild(item);
  });
}

async function refreshProfileBackups({ silent = false } = {}) {
  if (els.refreshBackupsBtn) els.refreshBackupsBtn.disabled = true;
  try {
    const data = await api("/api/user/profile/backups", {}, 1);
    renderProfileBackups(data.backups || []);
    if (!silent) showToast("资料备份列表已刷新", "success");
    return data.backups || [];
  } finally {
    if (els.refreshBackupsBtn) els.refreshBackupsBtn.disabled = false;
  }
}

async function restoreProfileBackup(backupPath) {
  if (!backupPath) return;
  setLoading(true, "正在恢复资料...");
  try {
    const data = await api("/api/user/profile/restore", {
      method: "POST",
      body: JSON.stringify({ backupPath })
    });
    if (data.state) render(data.state);
    else if (state) {
      state = { ...state, user: data.profile };
      renderMemory(data.profile);
    }
    showToast("已恢复导入前资料", "success");
    refreshProfileBackups({ silent: true }).catch(() => {});
  } finally {
    setLoading(false);
  }
}

async function exportProfile() {
  const data = await api("/api/user/profile", {}, 1);
  const payload = {
    app: "Claudio Music",
    exportedAt: new Date().toISOString(),
    profile: data.profile || {}
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = profileExportFilename();
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast("已导出本地资料", "success");
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        resolve(JSON.parse(String(reader.result || "{}")));
      } catch {
        reject(new Error("资料文件不是有效的 JSON。"));
      }
    });
    reader.addEventListener("error", () => reject(new Error("无法读取资料文件。")));
    reader.readAsText(file, "utf-8");
  });
}

async function importProfileFile(file) {
  if (!file) return;
  if (file.size > MAX_PROFILE_IMPORT_BYTES) {
    throw new Error("资料文件太大，请选择 1MB 以内的 JSON 备份。");
  }
  setLoading(true, "正在导入资料...");
  try {
    const payload = await readJsonFile(file);
    const profileData = payload.profile || payload;
    const data = await api("/api/user/profile", {
      method: "POST",
      body: JSON.stringify({ profile: profileData })
    });
    if (data.state) render(data.state);
    else if (state) {
      state = { ...state, user: data.profile };
      renderMemory(data.profile);
    }
    showToast(profileImportSummaryText(data.summary, data.backupPath), "success", data.backupPath ? {
      label: "撤销",
      onClick: () => restoreProfileBackup(data.backupPath).catch(error => showToast(validationSummary(error), "error"))
    } : undefined);
    refreshProfileBackups({ silent: true }).catch(() => {});
  } finally {
    setLoading(false);
  }
}

async function removeFromQueue(index, trackId) {
  try {
    const data = await api("/api/queue/remove", {
      method: "POST",
      body: JSON.stringify({ index, trackId })
    });
    render(data);
    showToast("已从队列移除", "info");
  } catch (error) {
    showToast(validationSummary(error), "error");
  }
}

async function restoreClearedQueue() {
  if (!lastClearedQueue?.length) return;
  try {
    setLoading(true, "正在恢复队列...");
    const restored = await api("/api/queue/restore", {
      method: "POST",
      body: JSON.stringify({ tracks: lastClearedQueue })
    }, 0);
    render(restored);
    lastClearedQueue = null;
    showToast("队列已恢复", "success");
  } catch (error) {
    showToast(validationSummary(error), "error");
  } finally {
    setLoading(false);
  }
}

async function clearQueue() {
  if (!state?.queue?.length) return;
  lastClearedQueue = state.queue.slice();
  try {
    const data = await api("/api/queue/clear", { method: "POST", body: JSON.stringify({}) });
    render(data);
    showToast("队列已清空", "info", { label: "撤销", onClick: restoreClearedQueue });
  } catch (error) {
    showToast(validationSummary(error), "error");
  }
}

async function toggleShuffle() {
  try {
    const data = await api("/api/queue/shuffle", {
      method: "POST",
      body: JSON.stringify({ shuffle: !shuffleOn })
    });
    shuffleOn = !shuffleOn;
    updateShuffleUi();
    render(data);
    showToast(shuffleOn ? "随机播放已开启" : "顺序播放", "info");
  } catch (error) {
    showToast(validationSummary(error), "error");
  }
}

function updateShuffleUi() {
  if (els.shuffleBtn) els.shuffleBtn.classList.toggle("shuffle-active", shuffleOn);
}

async function toggleRepeat() {
  repeatMode = (repeatMode + 1) % 3;
  updateRepeatUi();
  await saveSettings({ repeatMode });
  const labels = ["顺序播放", "列表循环", "单曲循环"];
  showToast(labels[repeatMode], "info");
}

function updateRepeatUi() {
  if (!els.repeatBtn) return;
  els.repeatBtn.classList.remove("shuffle-active", "repeat-one");
  if (repeatMode === 1) els.repeatBtn.classList.add("shuffle-active");
  if (repeatMode === 2) els.repeatBtn.classList.add("repeat-one");
  const titles = ["循环模式: 顺序", "循环模式: 列表循环", "循环模式: 单曲循环"];
  els.repeatBtn.title = titles[repeatMode];
}

function setSleepTimer(minutes) {
  if (sleepTicking) {
    clearInterval(sleepTicking);
    sleepTicking = null;
  }
  sleepUntil = null;
  els.sleepRemaining.setAttribute("hidden", "");

  minutes = Number(minutes) || 0;
  els.sleepDuration.value = String(minutes || 0);

  if (!minutes) {
    showToast("睡眠定时已关闭", "info");
    return;
  }

  sleepUntil = Date.now() + minutes * 60 * 1000;
  els.sleepRemaining.removeAttribute("hidden");
  els.sleepRemaining.textContent = formatTimerRemaining();

  sleepTicking = setInterval(() => {
    const left = Math.max(0, sleepUntil - Date.now());
    els.sleepRemaining.textContent = formatTimerRemaining();
    if (left <= 0) {
      clearInterval(sleepTicking);
      sleepTicking = null;
      sleepUntil = null;
      els.sleepDuration.value = "0";
      els.sleepRemaining.setAttribute("hidden", "");
      setPlaying(false).catch(() => {});
      showToast("⏰ 睡眠定时结束，已暂停播放", "info");
    }
  }, 10000);

  showToast(`睡眠定时已设置：${minutes} 分钟后暂停`, "info");
}

function formatTimerRemaining() {
  if (!sleepUntil) return "";
  const left = Math.max(0, Math.ceil((sleepUntil - Date.now()) / 1000));
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${m}:${pad(s)}`;
}

function updateMediaSession(track) {
  if (!("mediaSession" in navigator)) return;
  try {
    const artwork = [];
    if (track?.artwork) artwork.push({ src: track.artwork, sizes: "480x480", type: "image/jpeg" });
    if (typeof MediaMetadata !== "undefined") {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track?.title || "Claudio Music",
        artist: track?.artist || "",
        album: track?.album || "",
        artwork
      });
    }
    navigator.mediaSession.playbackState = player.active && !player.el.paused ? "playing" : "paused";
  } catch (error) {
    if (debugOn) console.warn("Media Session update failed", error);
  }
}

if ("mediaSession" in navigator) {
  try {
    navigator.mediaSession.setActionHandler("play", () => els.playBtn.click());
    navigator.mediaSession.setActionHandler("pause", () => els.playBtn.click());
    navigator.mediaSession.setActionHandler("previoustrack", () => els.prevBtn.click());
    navigator.mediaSession.setActionHandler("nexttrack", () => els.nextBtn.click());
    navigator.mediaSession.setActionHandler("stop", () => els.stopBtn.click());
  } catch (error) {
    if (debugOn) console.warn("Media Session action handlers failed", error);
  }
}

function showShortcuts() {
  shortcutReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  els.shortcutOverlay.removeAttribute("hidden");
  els.closeShortcutBtn.focus({ preventScroll: true });
}

function hideShortcuts() {
  els.shortcutOverlay.setAttribute("hidden", "");
  const target = shortcutReturnFocus && shortcutReturnFocus !== document.body ? shortcutReturnFocus : els.messageInput;
  shortcutReturnFocus = null;
  if (target && document.contains(target)) target.focus({ preventScroll: true });
}

function isShortcutDialogOpen() {
  return !els.shortcutOverlay.hasAttribute("hidden");
}

function shortcutFocusableElements() {
  return Array.from(els.shortcutOverlay.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
    .filter(element => !element.disabled && !element.hasAttribute("hidden"));
}

function trapShortcutFocus(event) {
  const focusable = shortcutFocusableElements();
  if (!focusable.length) {
    event.preventDefault();
    els.closeShortcutBtn.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const activeElement = document.activeElement;
  if (event.shiftKey && (!els.shortcutOverlay.contains(activeElement) || activeElement === first)) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

player.el.addEventListener("ended", () => {
  if (repeatMode === 2 && player.trackId) {
    player.el.currentTime = 0;
    player.el.play().catch(() => {});
    return;
  }
  if (state?.queue?.length > 1) {
    nextTrack(true).catch(error => showSystemMessage(error.message));
  } else if (repeatMode >= 1 && state?.queue?.length === 1 && state?.now) {
    // 列表循环 + 队列只有 1 首：重播当前曲目
    startAudio(state.now, { force: true, context: "repeat" }).catch(() => {});
  } else {
    setPlaying(false).catch(error => showSystemMessage(error.message));
  }
});

player.el.addEventListener("error", () => {
  if (!state?.now || !player.sourceUrl) return;
  handlePlaybackFailure("这个音频地址播放失败。");
});

player.el.addEventListener("timeupdate", () => {
  if (player.active && !player.el.paused) {
    localElapsed = player.el.currentTime || localElapsed;
    updateProgress();
  }
});

player.el.addEventListener("durationchange", () => {
  if (player.active && player.trackId === state?.now?.id) {
    updateProgress();
  }
});

els.playBtn.addEventListener("click", async () => {
  try {
    if (!state?.now) return await recommend("推荐几首适合现在的歌");
    if (player.active && !player.el.paused && player.trackId === state.now.id) {
      await setPlaying(false);
      return;
    }
    await setPlaying(true);
  } catch (error) {
    showSystemMessage(error.message);
  }
});

els.stopBtn.addEventListener("click", () => {
  setPlaying(false).catch(error => showSystemMessage(error.message));
});

els.prevBtn.addEventListener("click", () => {
  previousTrack().catch(error => showSystemMessage(error.message));
});

els.nextBtn.addEventListener("click", () => {
  nextTrack(true).catch(error => showSystemMessage(error.message));
});

els.likeBtn.addEventListener("click", async () => {
  if (!state?.now) return showSystemMessage("当前还没有可收藏的歌曲。");
  try {
    const data = await api("/api/user/favorite", {
      method: "POST",
      body: JSON.stringify({ track: state.now, favorite: !isCurrentFavorite() })
    });
    state = data.state;
    render(state);
    showSystemMessage(data.favorite ? `已收藏：${data.track.title}` : `已取消收藏：${data.track.title}`);
  } catch (error) {
    showSystemMessage(error.message);
  }
});

els.hideQueueBtn.addEventListener("click", () => {
  els.queuePanel.classList.toggle("collapsed");
  els.hideQueueBtn.textContent = els.queuePanel.classList.contains("collapsed") ? "SHOW" : "HIDE";
});

els.volumeSlider.addEventListener("input", applyVolume);
els.volumeSlider.addEventListener("change", async event => {
  const volume = Number(event.target.value);
  try {
    await api("/api/play", {
      method: "POST",
      body: JSON.stringify({ volume })
    });
    await saveSettings({ volume });
  } catch (error) {
    showSystemMessage(error.message);
  }
});

// 拖动进度条时实时更新显示（不 seek，仅视觉反馈）
els.progressSlider.addEventListener("input", event => {
  if (!state?.now) return;
  isDraggingProgress = true;

  const isPlayingCurrent = player.active && !player.el.paused && player.trackId === state.now.id;
  const duration = (isPlayingCurrent && Number.isFinite(player.el.duration) && player.el.duration > 0)
    ? player.el.duration
    : (state.now.duration || 1);

  const pct = Number(event.target.value) / 100;
  const seekTime = pct * Math.max(1, duration);

  els.elapsedTime.textContent = formatDuration(seekTime);
  updateSliderFill(els.progressSlider, Number(event.target.value));
});

// 松手时执行实际 seek
els.progressSlider.addEventListener("change", event => {
  isDraggingProgress = false;
  if (!state?.now) return;

  const isPlayingCurrent = player.active && !player.el.paused && player.trackId === state.now.id;
  const duration = (isPlayingCurrent && Number.isFinite(player.el.duration) && player.el.duration > 0)
    ? player.el.duration
    : (state.now.duration || 1);

  const pct = Number(event.target.value) / 100;
  localElapsed = pct * Math.max(1, duration);

  try {
    if (!isRadio(state.now) && Number.isFinite(player.el.duration) && player.el.duration > 0) {
      player.el.currentTime = Math.min(localElapsed, player.el.duration - 0.5);
    }
  } catch {
    showSystemMessage("这首歌暂时不能拖动进度。");
  }
  updateProgress();
});

els.composer.addEventListener("submit", event => {
  event.preventDefault();
  const text = els.messageInput.value.trim();
  if (!text) return;
  els.messageInput.value = "";
  sendMessage(text).catch(error => showSystemMessage(error.message));
});

els.chips.addEventListener("click", event => {
  const button = event.target.closest("button[data-prompt]");
  if (!button) return;
  sendMessage(button.dataset.prompt).catch(error => showSystemMessage(error.message));
});

els.smartRecommendBtn.addEventListener("click", () => {
  recommend("根据我的收藏、最近播放和偏好，推荐几首现在适合听的歌").catch(error => showSystemMessage(error.message));
});

els.recentBtn.addEventListener("click", () => {
  listSavedTracks("最近播放", profile().history || [], "还没有最近播放记录。先听几首歌，我会记住。", "recent");
});

els.favoritesBtn.addEventListener("click", () => {
  listSavedTracks("我的收藏", profile().favorites || [], "还没有收藏。听到喜欢的歌时点一下爱心。", "favorite");
});

els.copyTrackBtn.addEventListener("click", () => {
  copyCurrentTrack().catch(error => showToast(validationSummary(error), "error"));
});

els.exportProfileBtn.addEventListener("click", () => {
  exportProfile().catch(error => showToast(validationSummary(error), "error"));
});

els.importProfileBtn.addEventListener("click", () => {
  els.importProfileInput.value = "";
  els.importProfileInput.click();
});

els.importProfileInput.addEventListener("change", event => {
  const file = event.target.files?.[0];
  importProfileFile(file).catch(error => showToast(validationSummary(error), "error"));
});

els.refreshBackupsBtn?.addEventListener("click", () => {
  refreshProfileBackups().catch(error => showToast(validationSummary(error), "error"));
});

els.aiSettings.addEventListener("submit", event => {
  event.preventDefault();
  saveAiConfig().catch(error => showSystemMessage(validationSummary(error)));
});

els.memorySettings.addEventListener("submit", event => {
  event.preventDefault();
  savePreferences().catch(error => showSystemMessage(validationSummary(error)));
});

els.clearAiBtn.addEventListener("click", () => {
  clearAiConfig().catch(error => showSystemMessage(validationSummary(error)));
});

els.installBtn.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  renderInstallStatus();
  try {
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === "accepted") {
      updateInstallStatus("已安装", "online");
      showSystemMessage("Claudio Music 已加入系统应用。");
    } else {
      showSystemMessage("已取消安装，仍可继续在浏览器中使用。");
      renderInstallStatus();
    }
  } catch {
    showSystemMessage("当前浏览器没有完成安装流程，可以继续在浏览器中使用。");
    renderInstallStatus();
  }
});

document.querySelectorAll(".theme-choice").forEach(button => {
  button.addEventListener("click", () => {
    const theme = button.dataset.theme === "light" ? "light" : "dark";
    applyTheme(theme);
    saveSettings({ theme }).catch(error => showSystemMessage(error.message));
  });
});

setInterval(() => {
  if (state?.status === "ON AIR" && (!player.active || player.el.paused)) {
    localElapsed += 0.25;
    updateProgress();
  }
}, 250);

setInterval(updateClock, 1000);
updateClock();
setChip(els.serviceStatus, "服务检查中", "warning");
updateNetworkStatus(false);
renderInstallStatus();

window.addEventListener("online", () => {
  updateNetworkStatus(true);
  resumeRealtimeSync("online");
});
window.addEventListener("offline", () => updateNetworkStatus(true));

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  renderInstallStatus();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallStatus("已安装", "online");
  showSystemMessage("Claudio Music 已安装，可以像桌面应用一样打开。");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshingForServiceWorker) return;
    window.location.reload();
  });
  navigator.serviceWorker.register("/service-worker.js").then(registration => {
    swRegistration = registration;
    updateCacheStatus("缓存就绪", "online");
    if (registration.waiting) {
      promptServiceWorkerRefresh("已有新版界面缓存完成，点刷新即可使用。");
    }
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      updateCacheStatus("缓存更新中", "warning");
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") {
          if (navigator.serviceWorker.controller) {
            promptServiceWorkerRefresh("新版界面已缓存，点刷新即可切换。");
          } else {
            updateCacheStatus("缓存就绪", "online");
          }
        }
      });
    });
    registration.update().catch(() => {});
  }).catch(() => {
    updateCacheStatus("缓存不可用", "offline");
  });
} else {
  updateCacheStatus("缓存不可用", "offline");
}

async function tryRefresh(retries = 4, delay = 1200) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await api("/api/now");
      render(data);
      return data;
    } catch (error) {
      if (error.name === "TypeError" && isLoopbackHost()) {
        const resolved = await recoverLocalOrigin();
        if (resolved) return;
      }
      if (attempt < retries) {
        els.trackTitle.textContent = "正在连接服务";
        els.trackArtist.textContent = `第 ${attempt + 1} 次尝试...`;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      els.trackTitle.textContent = "服务未启动";
      els.trackArtist.textContent = error.message;
    }
  }
}

let eventStream = null;
let eventStreamReconnectTimer = null;
let eventStreamReconnectAttempt = 0;
let lastResumeSyncAt = 0;

async function resumeRealtimeSync(reason = "resume") {
  if (document.hidden) return;
  const now = Date.now();
  if (now - lastResumeSyncAt < 1500) return;
  lastResumeSyncAt = now;

  if (eventStreamReconnectTimer) {
    clearTimeout(eventStreamReconnectTimer);
    eventStreamReconnectTimer = null;
  }

  try {
    await refreshServiceHealth();
    const data = await api("/api/now", {}, 1);
    render(data);
    connectEventStream();
  } catch {
    setChip(els.serviceStatus, reason === "online" ? "服务恢复检查中" : "服务重连中", "warning");
    if (!eventStream) scheduleEventStreamReconnect();
  }
}

function scheduleEventStreamReconnect() {
  if (eventStreamReconnectTimer) return;
  const delay = STREAM_RECONNECT_DELAYS[Math.min(eventStreamReconnectAttempt, STREAM_RECONNECT_DELAYS.length - 1)];
  eventStreamReconnectAttempt += 1;
  eventStreamReconnectTimer = setTimeout(() => {
    eventStreamReconnectTimer = null;
    connectEventStream();
  }, delay);
}

function closeEventStream() {
  if (!eventStream) return;
  eventStream.close();
  eventStream = null;
}

async function resyncAfterStreamReconnect() {
  try {
    await refreshServiceHealth();
    const data = await api("/api/now", {}, 1);
    render(data);
  } catch {
    // The reconnect loop will keep trying while the backend is unavailable.
  }
}

function connectEventStream() {
  if (typeof EventSource === "undefined" || eventStream) return;
  try {
    eventStream = new EventSource("/api/stream");
    eventStream.addEventListener("open", () => {
      eventStreamReconnectAttempt = 0;
      renderServiceHealth(latestHealth || {
        ok: true,
        queueSize: state?.queue?.length || 0,
        frontendVersion: state?.frontendVersion
      }, "online");
      resyncAfterStreamReconnect();
    });
    eventStream.addEventListener("now", event => {
      try {
        render(JSON.parse(event.data));
      } catch {}
    });
    eventStream.addEventListener("error", () => {
      closeEventStream();
      setChip(els.serviceStatus, "实时同步重连中", "warning");
      scheduleEventStreamReconnect();
    });
  } catch {
    closeEventStream();
    scheduleEventStreamReconnect();
  }
}

refreshServiceHealth().catch(() => {});
tryRefresh().then(() => {
  renderServiceHealth({
    ok: true,
    queueSize: state?.queue?.length || 0,
    frontendVersion: state?.frontendVersion
  }, "online");
  connectEventStream();
  scheduleShortcutAction();
}).catch(() => {});

refreshAiStatus().catch(() => {});
refreshProfileBackups({ silent: true }).catch(() => {});

document.addEventListener("keydown", event => {
  if (isShortcutDialogOpen()) {
    if (event.key === "Tab") {
      trapShortcutFocus(event);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideShortcuts();
      return;
    }
    return;
  }

  const activeElement = document.activeElement;
  const tag = activeElement?.tagName;
  const isEditing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (isEditing) {
    if (event.key === "/" && activeElement === els.messageInput && !els.messageInput.value.trim()) {
      event.preventDefault();
      els.queueSearch?.focus({ preventScroll: true });
    }
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.key === " " || event.code === "Space") {
    if (activeElement && (activeElement.tagName === "BUTTON" || activeElement.tagName === "A" || activeElement.tagName === "SELECT")) return;
    event.preventDefault();
    els.playBtn.click();
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    els.prevBtn.click();
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    els.nextBtn.click();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    const vol = Math.min(1, Number(els.volumeSlider.value || 0.68) + 0.05);
    els.volumeSlider.value = vol;
    applyVolume();
    saveSettings({ volume: vol }).catch(() => {});
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    const vol = Math.max(0, Number(els.volumeSlider.value || 0.68) - 0.05);
    els.volumeSlider.value = vol;
    applyVolume();
    saveSettings({ volume: vol }).catch(() => {});
    return;
  }

  if (event.key === "f" || event.key === "F") {
    event.preventDefault();
    els.likeBtn.click();
    return;
  }

  if (event.key === "/") {
    event.preventDefault();
    els.queueSearch?.focus({ preventScroll: true });
    return;
  }

  if (event.key === "c" || event.key === "C") {
    event.preventDefault();
    copyCurrentTrack().catch(error => showToast(validationSummary(error), "error"));
    return;
  }

  if (event.key === "s" || event.key === "S") {
    event.preventDefault();
    els.stopBtn.click();
    return;
  }

  if (event.key === "?") {
    event.preventDefault();
    showShortcuts();
    return;
  }

  if (event.key === "Escape") {
    hideShortcuts();
    return;
  }
});

els.closeShortcutBtn.addEventListener("click", hideShortcuts);
els.shortcutOverlay.addEventListener("click", event => {
  if (event.target === els.shortcutOverlay) hideShortcuts();
});

els.shuffleBtn.addEventListener("click", () => toggleShuffle().catch(error => showToast(validationSummary(error), "error")));
els.repeatBtn.addEventListener("click", () => toggleRepeat().catch(error => showToast(validationSummary(error), "error")));
els.copyQueueBtn.addEventListener("click", () => copyQueue().catch(error => showToast(validationSummary(error), "error")));
els.clearQueueBtn.addEventListener("click", () => clearQueue().catch(error => showToast(validationSummary(error), "error")));
els.refreshLibraryBtn?.addEventListener("click", () => refreshLibrary().catch(error => showToast(validationSummary(error), "error")));

els.sleepBtn.addEventListener("click", () => {
  const hidden = els.sleepOptions.hasAttribute("hidden");
  if (hidden) {
    els.sleepOptions.removeAttribute("hidden");
    els.sleepBtn.setAttribute("aria-expanded", "true");
  } else {
    els.sleepOptions.setAttribute("hidden", "");
    els.sleepBtn.setAttribute("aria-expanded", "false");
  }
});

els.sleepDuration.addEventListener("change", () => {
  setSleepTimer(Number(els.sleepDuration.value));
});

els.messageInput.addEventListener("input", () => {
  const len = els.messageInput.value.length;
  if (els.charCount) els.charCount.textContent = `${len}/200`;
});

els.queueSearch?.addEventListener("input", () => {
  queueSearchTerm = els.queueSearch.value;
  if (els.clearQueueSearchBtn) els.clearQueueSearchBtn.hidden = !queueSearchTerm.trim();
  if (state) render(state);
});

els.clearQueueSearchBtn?.addEventListener("click", () => {
  queueSearchTerm = "";
  els.queueSearch.value = "";
  els.clearQueueSearchBtn.hidden = true;
  if (state) render(state);
  els.queueSearch.focus({ preventScroll: true });
});

els.messageInput.focus();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (state?.status === "ON AIR" && player.active && !player.el.paused) {
    localElapsed = player.el.currentTime || localElapsed;
    updateProgress();
  }
  resumeRealtimeSync("visible");
});
