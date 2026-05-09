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
  clearAiBtn: document.querySelector("#clearAiBtn")
};

let state = null;
let localElapsed = 0;

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

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `API ${path} failed`);
  return payload;
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

function showSystemMessage(text) {
  if (!state) return;
  const messages = Array.isArray(state.messages) ? state.messages.slice() : [];
  messages.push({ role: "ai", at: clockStamp(), text });
  state = { ...state, messages };
  renderMessages(messages);
}

function renderAiStatus(ai) {
  if (!els.aiStatus) return;
  const enabled = Boolean(ai?.enabled);
  els.aiStatus.textContent = enabled ? `已连接 · ${ai.model || "DeepSeek"}` : "未连接";
  els.aiStatus.classList.toggle("connected", enabled);
  if (els.deepseekModel && ai?.model) els.deepseekModel.value = ai.model;
  if (els.deepseekBase && ai?.apiBase) els.deepseekBase.value = ai.apiBase;
}

function stopAudio() {
  player.requestId += 1;
  player.el.pause();
  player.active = false;
  updatePlaybackUi();
}

async function startAudio(track, options = {}) {
  const { force = false } = options;
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
    player.active = true;
    updatePlaybackUi();
  } catch (error) {
    if (requestId !== player.requestId || error?.name === "AbortError") return;
    player.active = false;
    updatePlaybackUi();
    showSystemMessage(`没有开始播放：${friendlyAudioError(error)}`);
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

  queue.forEach(track => {
    const item = document.createElement("li");
    item.className = "queue-item";
    item.tabIndex = 0;
    item.role = "button";
    item.innerHTML = `
      <span class="marker">${track.id === currentId ? "▶" : "·"}</span>
      <span><strong>${escapeHtml(track.title)}</strong> - ${escapeHtml(track.artist)}</span>
      <time>${formatDuration(track.duration)}</time>
    `;
    item.addEventListener("click", () => playIndex(track.index, true));
    item.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        playIndex(track.index, true);
      }
    });
    els.queueList.appendChild(item);
  });
}

function renderCover(track) {
  els.coverArt.className = `cover source-${track?.source || "local"}`;
  if (track?.artwork) {
    els.coverArt.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.12)), url("${track.artwork}")`;
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
  renderCover(track);
  renderQueue(queue, track?.id);
  renderMessages(data.messages || []);
  updateProgress();
  updatePlaybackUi();
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

async function playIndex(index, forceAudio = false) {
  const data = await api("/api/play", {
    method: "POST",
    body: JSON.stringify({ index, playing: true })
  });
  render(data);
  await startAudio(data.now, { force: forceAudio });
}

async function setPlaying(playing) {
  const data = await api("/api/play", {
    method: "POST",
    body: JSON.stringify({ playing })
  });
  render(data);
  if (playing) await startAudio(data.now, { force: true });
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
  if (data.status === "ON AIR") await startAudio(data.now, { force: true });
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
  if (data.status === "ON AIR") await startAudio(data.now, { force: true });
}

async function recommend(message = "推荐几首适合现在的歌") {
  unlockAudio();
  updatePlaybackUi("LOADING");
  const data = await api("/api/music/recommend", {
    method: "POST",
    body: JSON.stringify({ message })
  });
  render(data);
  await startAudio(data.now, { force: true });
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
    if (data.now && data.status === "ON AIR") await startAudio(data.now, { force: true });
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
}

player.el.addEventListener("ended", () => {
  if (state?.queue?.length > 1) nextTrack(true).catch(error => showSystemMessage(error.message));
  else setPlaying(false).catch(error => showSystemMessage(error.message));
});

player.el.addEventListener("error", () => {
  if (!state?.now || !player.sourceUrl) return;
  player.active = false;
  updatePlaybackUi();
  showSystemMessage("这个音频地址播放失败，我会尝试队列里的下一首真实音乐。");
  if (state.queue?.length > 1) nextTrack(true).catch(error => showSystemMessage(error.message));
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

els.likeBtn.addEventListener("click", () => {
  els.likeBtn.style.color = "var(--danger)";
});

els.hideQueueBtn.addEventListener("click", () => {
  els.queuePanel.classList.toggle("collapsed");
  els.hideQueueBtn.textContent = els.queuePanel.classList.contains("collapsed") ? "SHOW" : "HIDE";
});

els.volumeSlider.addEventListener("input", applyVolume);
els.volumeSlider.addEventListener("change", async event => {
  try {
    await api("/api/play", {
      method: "POST",
      body: JSON.stringify({ volume: Number(event.target.value) })
    });
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

els.aiSettings.addEventListener("submit", event => {
  event.preventDefault();
  saveAiConfig().catch(error => showSystemMessage(error.message));
});

els.clearAiBtn.addEventListener("click", () => {
  clearAiConfig().catch(error => showSystemMessage(error.message));
});

document.querySelectorAll(".theme-choice").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".theme-choice").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    els.body.classList.toggle("light", button.dataset.theme === "light");
  });
});

setInterval(() => {
  if (state?.status === "ON AIR" && (!player.active || player.el.paused)) {
    localElapsed += 1;
    updateProgress();
  }
}, 1000);

setInterval(updateClock, 1000);
updateClock();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").then(registration => {
    registration.update().catch(() => {});
  }).catch(() => {});
}

refresh().catch(error => {
  els.trackTitle.textContent = "服务未启动";
  els.trackArtist.textContent = error.message;
});

refreshAiStatus().catch(() => {});
