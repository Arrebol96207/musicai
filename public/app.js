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
  installBtn: document.querySelector("#installBtn"),
  queueCount: document.querySelector("#queueCount"),
  nextCount: document.querySelector("#nextCount"),
  queueList: document.querySelector("#queueList"),
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
  aiStatus: document.querySelector("#aiStatus"),
  clearAiBtn: document.querySelector("#clearAiBtn"),
  smartRecommendBtn: document.querySelector("#smartRecommendBtn"),
  recentBtn: document.querySelector("#recentBtn"),
  favoritesBtn: document.querySelector("#favoritesBtn"),
  memorySettings: document.querySelector("#memorySettings"),
  memoryStatus: document.querySelector("#memoryStatus"),
  prefArtists: document.querySelector("#prefArtists"),
  prefGenres: document.querySelector("#prefGenres"),
  prefAvoid: document.querySelector("#prefAvoid"),
  charCount: document.querySelector("#charCount"),
  toastContainer: document.querySelector("#toastContainer"),
  shortcutOverlay: document.querySelector("#shortcutOverlay"),
  closeShortcutBtn: document.querySelector("#closeShortcutBtn"),
  loadingOverlay: document.querySelector("#loadingOverlay"),
  shuffleBtn: document.querySelector("#shuffleBtn"),
  repeatBtn: document.querySelector("#repeatBtn"),
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
const QUEUE_RENDER_LIMIT = 80;

function isDebugEnabled() {
  try {
    return new URLSearchParams(window.location.search).has("debug") || window.localStorage?.getItem("claudioDebug") === "1";
  } catch {
    return false;
  }
}

const debugOn = isDebugEnabled();

const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
}

async function api(path, options = {}, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        ...options
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(payload.error || "服务暂时不可用，请稍后再试。");
        error.status = res.status;
        error.code = payload.code;
        error.fields = payload.fields;
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < retries && (
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
  const timeout = Math.min(9000, Math.max(4100, String(text).length * 80));
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, timeout);
}

function profile() {
  return state?.user || {};
}

function isCurrentFavorite() {
  return Boolean(state?.now?.id && profile().favoriteIds?.includes(state.now.id));
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
  if (els.deepseekModel && ai?.model) els.deepseekModel.value = ai.model;
  if (els.deepseekBase && ai?.apiBase) els.deepseekBase.value = ai.apiBase;
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

function updateCacheStatus(text, tone = "") {
  setChip(els.cacheStatus, text, tone);
}

function renderMemory(profileData = profile()) {
  const preferences = profileData.preferences || {};
  const settings = profileData.settings || {};
  const favorites = profileData.favorites || [];
  const history = profileData.history || [];

  els.prefArtists.value = (preferences.artists || []).join(", ");
  els.prefGenres.value = (preferences.genres || []).join(", ");
  els.prefAvoid.value = (preferences.avoid || []).join(", ");
  els.memoryStatus.textContent = `${favorites.length} 收藏 · ${history.length} 最近`;

  const theme = settings.theme === "light" ? "light" : "dark";
  els.body.classList.toggle("light", theme === "light");
  document.querySelectorAll(".theme-choice").forEach(button => {
    button.classList.toggle("active", button.dataset.theme === theme);
  });
  if (typeof settings.volume === "number") {
    els.volumeSlider.value = settings.volume;
    applyVolume();
  }
}

function stopAudio() {
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

  if (!isRadio(track) && Number.isFinite(localElapsed) && localElapsed > 0) {
    try {
      player.el.currentTime = Math.min(localElapsed, Math.max(0, (track.duration || 1) - 1));
    } catch {
      // Some remote streams only become seekable after metadata is loaded.
    }
  }

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
  wrapper.innerHTML = `
    <span class="meta">${message.role === "user" ? "你" : "Claudio"} ${escapeHtml(message.at)}</span>
    <div class="bubble">${escapeHtml(message.text)}</div>
  `;
  return wrapper;
}

function renderMessages(messages) {
  els.messages.innerHTML = "";
  (messages || []).forEach(message => els.messages.appendChild(renderMessage(message)));
  els.messages.scrollTop = els.messages.scrollHeight;
}

function normalizedQueue(data) {
  const queue = data.queue || [];
  return queue.map((track, index) => ({ ...track, index }));
}

function renderQueue(queue, currentId) {
  const visibleQueue = queue.slice(0, QUEUE_RENDER_LIMIT);
  const signature = `${queue.length}:${visibleQueue.map(track => `${track.id}:${track.favorite ? 1 : 0}:${track.id === currentId ? 1 : 0}`).join("|")}`;
  if (els.queueList.dataset.signature === signature) return;
  els.queueList.dataset.signature = signature;
  els.queueList.innerHTML = "";

  if (!queue.length) {
    const empty = document.createElement("li");
    empty.className = "queue-item";
    empty.innerHTML = `
      <span class="marker">+</span>
      <span><strong>还没有歌曲</strong> 发送一句“推荐几首适合现在的歌”开始</span>
      <time>0:00</time>
    `;
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
    item.innerHTML = `
      <span class="marker">${track.id === currentId ? "▶" : track.favorite ? "♥" : "·"}</span>
      <span><strong>${escapeHtml(track.title)}</strong> - ${escapeHtml(track.artist)}${sourceLabel ? ` <small>${escapeHtml(sourceLabel)}</small>` : ""}</span>
      <time>${formatDuration(track.duration)}</time>
      ${canRemove ? `<button class="remove-btn" title="从队列移除" aria-label="移除 ${escapeHtml(track.title)}">×</button>` : ""}
    `;
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

  if (queue.length > visibleQueue.length) {
    const more = document.createElement("li");
    more.className = "queue-item queue-more";
    more.innerHTML = `
      <span class="marker">…</span>
      <span><strong>还有 ${queue.length - visibleQueue.length} 首未显示</strong> 队列过长时仅渲染前 ${QUEUE_RENDER_LIMIT} 首以保持流畅</span>
      <time>${queue.length}</time>
    `;
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
  if (!player.active || trackChanged) localElapsed = data.elapsed || 0;

  els.trackTitle.textContent = track?.title || "告诉 Claudio 你想听什么";
  els.trackArtist.textContent = track?.artist || "输入心情、歌名、歌手或风格，我会推荐并播放真实音乐。";
  els.transportTitle.textContent = track ? `${track.title} - ${track.artist}` : "等待点歌";
  els.queueCount.textContent = `${queue.length} 首`;
  els.nextCount.textContent = `${Math.max(0, queue.length - 1)} 首`;
  els.libraryCount.textContent = queue.length;
  els.volumeSlider.value = data.volume ?? 0.68;
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
    return;
  }

  const current = player.active && !player.el.paused && player.trackId === state.now.id
    ? player.el.currentTime
    : localElapsed;
  const duration = Math.max(1, state.now.duration || 1);

  els.elapsedTime.textContent = formatDuration(current);
  els.progressSlider.value = String(Math.min(100, Math.max(0, (current / duration) * 100)));
}

async function refresh() {
  render(await api("/api/now"));
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
    body: JSON.stringify({ apiKey, model, apiBase })
  });
  els.deepseekKey.value = "";
  renderAiStatus(data.ai);
  showSystemMessage(`DeepSeek 已连接：${data.ai.model}`);
}

async function clearAiConfig() {
  const data = await api("/api/ai/clear", { method: "POST", body: JSON.stringify({}) });
  els.deepseekKey.value = "";
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
  let data = await api("/api/next");
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
  let data = await api("/api/previous");
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
    els.messageInput.focus();
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
    els.messageInput.focus();
  }
}

function setBusy(isBusy) {
  els.messageInput.disabled = isBusy;
  els.composer.querySelector("button").disabled = isBusy;
  els.chips.querySelectorAll("button").forEach(button => {
    button.disabled = isBusy;
  });
  [els.smartRecommendBtn, els.recentBtn, els.favoritesBtn].forEach(button => {
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

function toggleRepeat() {
  repeatMode = (repeatMode + 1) % 3;
  updateRepeatUi();
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
  els.shortcutOverlay.removeAttribute("hidden");
}

function hideShortcuts() {
  els.shortcutOverlay.setAttribute("hidden", "");
}

player.el.addEventListener("ended", () => {
  if (repeatMode === 2 && player.trackId) {
    player.el.currentTime = 0;
    player.el.play().catch(() => {});
    return;
  }
  if (state?.queue?.length > 1) nextTrack(true).catch(error => showSystemMessage(error.message));
  else if (repeatMode === 1 && state?.queue?.length) nextTrack(true).catch(() => {});
  else setPlaying(false).catch(error => showSystemMessage(error.message));
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

els.progressSlider.addEventListener("change", event => {
  if (!state?.now) return;
  localElapsed = (Number(event.target.value) / 100) * (state.now.duration || 1);
  try {
    if (!isRadio(state.now)) player.el.currentTime = localElapsed;
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

els.aiSettings.addEventListener("submit", event => {
  event.preventDefault();
  saveAiConfig().catch(error => showSystemMessage(validationSummary(error)));
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

els.memorySettings.addEventListener("submit", event => {
  event.preventDefault();
  savePreferences().catch(error => showSystemMessage(error.message));
});

document.querySelectorAll(".theme-choice").forEach(button => {
  button.addEventListener("click", () => {
    const theme = button.dataset.theme === "light" ? "light" : "dark";
    els.body.classList.toggle("light", theme === "light");
    document.querySelectorAll(".theme-choice").forEach(item => item.classList.toggle("active", item === button));
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
setChip(els.serviceStatus, "本地服务", "online");
updateNetworkStatus(false);
renderInstallStatus();

window.addEventListener("online", () => updateNetworkStatus(true));
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
  navigator.serviceWorker.register("/service-worker.js").then(registration => {
    swRegistration = registration;
    updateCacheStatus("缓存就绪", "online");
    if (registration.waiting) {
      updateCacheStatus("刷新可更新", "warning");
      showSystemMessage("已有新版界面缓存完成，刷新页面即可使用。");
    }
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      updateCacheStatus("缓存更新中", "warning");
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") {
          if (navigator.serviceWorker.controller) {
            updateCacheStatus("刷新可更新", "warning");
            showSystemMessage("新版界面已缓存，刷新页面即可切换。");
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

tryRefresh().catch(() => {});

refreshAiStatus().catch(() => {});

document.addEventListener("keydown", event => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  if (event.key === " " || event.code === "Space") {
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
els.repeatBtn.addEventListener("click", toggleRepeat);
els.clearQueueBtn.addEventListener("click", () => clearQueue().catch(error => showToast(validationSummary(error), "error")));

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

els.messageInput.focus();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (state?.status === "ON AIR" && player.active && !player.el.paused) {
    localElapsed = player.el.currentTime || localElapsed;
    updateProgress();
  }
});
