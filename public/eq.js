(function () {
  "use strict";

  const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const BAND_Q = 1.1;
  const GAIN_MIN = -12;
  const GAIN_MAX = 12;
  const PREAMP_MIN = -6;
  const PREAMP_MAX = 6;

  const PRESETS = {
    flat: { label: "平坦", preamp: 0, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    pop: { label: "流行", preamp: 0, gains: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2] },
    rock: { label: "摇滚", preamp: -1, gains: [4, 3, 1, -1, -1, 0, 2, 4, 5, 5] },
    jazz: { label: "爵士", preamp: 0, gains: [3, 2, 1, 2, -1, -1, 0, 1, 3, 4] },
    classical: { label: "古典", preamp: 0, gains: [4, 3, 2, 0, -1, -1, 0, 2, 3, 4] },
    electronic: { label: "电子", preamp: -1, gains: [5, 4, 1, 0, -2, 1, 1, 3, 4, 5] },
    vocal: { label: "人声增强", preamp: 0, gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
    bass: { label: "低音增强", preamp: -2, gains: [8, 6, 4, 2, 0, 0, 0, 0, 0, 0] }
  };

  const state = {
    enabled: false,
    preset: "flat",
    preamp: 0,
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  };

  let baseElement = null;
  let activeElement = null;
  let gestureBound = false;
  let resumeSafetyTimer = 0;

  const graph = {
    ctx: null,
    el: null,
    source: null,
    preamp: null,
    bands: [],
    analyser: null
  };

  const visualizer = {
    canvas: null,
    ctx2d: null,
    raf: 0,
    data: null
  };

  function clamp(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return min;
    return Math.max(min, Math.min(max, num));
  }

  function dBToLinear(db) {
    return Math.pow(10, db / 20);
  }

  function frequencyLabel(frequency) {
    return frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
  }

  function ensureGraph() {
    if (graph.ctx) return true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    try {
      graph.ctx = new AudioCtx();
      graph.source = graph.ctx.createMediaElementSource(graph.el);
      graph.preamp = graph.ctx.createGain();
      graph.bands = FREQUENCIES.map(frequency => {
        const filter = graph.ctx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = frequency;
        filter.Q.value = BAND_Q;
        filter.gain.value = 0;
        return filter;
      });
      graph.analyser = graph.ctx.createAnalyser();
      graph.analyser.fftSize = 256;
      graph.analyser.smoothingTimeConstant = 0.78;

      let node = graph.source;
      node.connect(graph.preamp);
      node = graph.preamp;
      graph.bands.forEach(band => {
        node.connect(band);
        node = band;
      });
      node.connect(graph.analyser);
      graph.analyser.connect(graph.ctx.destination);

      applyGraphValues();
      bindGestureResume();
      return true;
    } catch {
      graph.ctx = null;
      graph.bands = [];
      return false;
    }
  }

  function bindGestureResume() {
    if (gestureBound) return;
    gestureBound = true;
    const resume = () => {
      if (graph.ctx && graph.ctx.state === "suspended") {
        graph.ctx.resume().catch(() => {});
      }
    };
    document.addEventListener("pointerdown", resume, { passive: true });
    document.addEventListener("keydown", resume);
  }

  function applyGraphValues() {
    if (!graph.ctx) return;
    graph.preamp.gain.value = dBToLinear(state.preamp);
    graph.bands.forEach((band, index) => {
      band.gain.value = clamp(state.gains[index] || 0, GAIN_MIN, GAIN_MAX);
    });
  }

  function wantsEq(track) {
    return state.enabled && Boolean(graph.ctx) && track?.source === "local";
  }

  function pauseQuietly(element) {
    if (!element) return;
    try {
      element.pause();
    } catch {}
  }

  function clearElement(element) {
    if (!element) return;
    try {
      element.pause();
      element.removeAttribute("src");
      element.load();
    } catch {}
  }

  function syncVolume() {
    if (graph.el && baseElement) graph.el.volume = baseElement.volume;
  }

  // 自动播放策略可能让 AudioContext 长时间 suspended，超时仍未恢复就退回基础元素，避免整段静音
  function armResumeSafety() {
    if (!graph.ctx || graph.ctx.state === "running") return;
    graph.ctx.resume().catch(() => {});
    if (resumeSafetyTimer) clearTimeout(resumeSafetyTimer);
    resumeSafetyTimer = setTimeout(() => {
      resumeSafetyTimer = 0;
      if (graph.ctx && graph.ctx.state !== "running" && activeElement === graph.el && graph.el.src) {
        movePlayback(baseElement);
      }
    }, 1500);
  }

  function setBaseElement(element) {
    baseElement = element || null;
    if (!activeElement) activeElement = baseElement;
  }

  function currentElement() {
    return activeElement || baseElement;
  }

  function elements() {
    return [baseElement, graph.el].filter(Boolean);
  }

  function prepare(track) {
    const target = wantsEq(track) ? graph.el : baseElement;
    const previous = activeElement;
    activeElement = target || baseElement;
    if (previous && previous !== activeElement) {
      pauseQuietly(previous);
    }
    syncVolume();
    if (activeElement === graph.el) armResumeSafety();
    return activeElement;
  }

  function movePlayback(target) {
    const source = activeElement;
    if (!target || !source || target === source || !source.src) return false;
    const resumeAt = source.currentTime || 0;
    const wasPaused = source.paused;
    activeElement = target;
    target.src = source.src;
    target.volume = source.volume;
    try {
      target.currentTime = resumeAt;
    } catch {}
    clearElement(source);
    if (!wasPaused) {
      const playback = target.play();
      if (playback && typeof playback.catch === "function") {
        playback.catch(() => {});
      }
    }
    return true;
  }

  // 开启/关闭 EQ 时把正在播放（或暂停中）的曲目无缝换到对应元素
  function migrate(track) {
    const target = wantsEq(track) ? graph.el : baseElement;
    if (target === graph.el) armResumeSafety();
    return movePlayback(target);
  }

  function isEnabled() {
    return state.enabled;
  }

  function enable() {
    if (!ensureGraph()) return false;
    state.enabled = true;
    if (graph.ctx.state === "suspended") {
      graph.ctx.resume().catch(() => {});
    }
    return true;
  }

  function disable() {
    state.enabled = false;
    return true;
  }

  function setPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return false;
    state.preset = name;
    state.preamp = clamp(preset.preamp, PREAMP_MIN, PREAMP_MAX);
    state.gains = preset.gains.map(value => clamp(value, GAIN_MIN, GAIN_MAX));
    applyGraphValues();
    return true;
  }

  function setGain(index, db) {
    if (index < 0 || index >= FREQUENCIES.length) return false;
    state.gains[index] = clamp(db, GAIN_MIN, GAIN_MAX);
    if (state.preset !== "custom") state.preset = "custom";
    applyGraphValues();
    return true;
  }

  function setPreamp(db) {
    state.preamp = clamp(db, PREAMP_MIN, PREAMP_MAX);
    applyGraphValues();
    return true;
  }

  function getState() {
    return {
      enabled: state.enabled,
      preset: state.preset,
      preamp: state.preamp,
      gains: state.gains.slice()
    };
  }

  function restore(raw) {
    const data = raw && typeof raw === "object" ? raw : {};
    if (data.preset === "custom" || PRESETS[data.preset]) state.preset = data.preset;
    state.preamp = clamp(Number(data.preamp) || 0, PREAMP_MIN, PREAMP_MAX);
    if (Array.isArray(data.gains)) {
      state.gains = FREQUENCIES.map((_, index) => clamp(Number(data.gains[index]) || 0, GAIN_MIN, GAIN_MAX));
    }
    if (data.enabled === true) {
      // AudioContext 可能因自动播放策略处于 suspended，等首次手势后恢复
      if (ensureGraph()) {
        state.enabled = true;
        if (graph.ctx.state === "suspended") graph.ctx.resume().catch(() => {});
      }
    } else {
      state.enabled = false;
    }
    applyGraphValues();
  }

  function presets() {
    return Object.keys(PRESETS).map(key => ({ key, label: PRESETS[key].label }));
  }

  function bands() {
    return FREQUENCIES.map((frequency, index) => ({
      index,
      frequency,
      label: frequencyLabel(frequency),
      gain: state.gains[index] || 0
    }));
  }

  function passthroughNotice(track) {
    return state.enabled && track && track.source !== "local";
  }

  function drawIdleFrame() {
    const ctx = visualizer.ctx2d;
    const canvas = visualizer.canvas;
    if (!ctx || !canvas) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(139, 92, 246, 0.18)";
    const barCount = 32;
    const gap = Math.max(1, Math.floor(width / barCount / 4));
    const barWidth = (width - gap * (barCount - 1)) / barCount;
    for (let i = 0; i < barCount; i += 1) {
      const barHeight = 2;
      ctx.fillRect(i * (barWidth + gap), height - barHeight, barWidth, barHeight);
    }
  }

  function drawFrame() {
    const ctx = visualizer.ctx2d;
    const canvas = visualizer.canvas;
    if (!ctx || !canvas) return;
    if (!state.enabled || !graph.analyser) {
      drawIdleFrame();
      return;
    }
    if (!visualizer.data || visualizer.data.length !== graph.analyser.frequencyBinCount) {
      visualizer.data = new Uint8Array(graph.analyser.frequencyBinCount);
    }
    graph.analyser.getByteFrequencyData(visualizer.data);

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const barCount = 32;
    const gap = Math.max(1, Math.floor(width / barCount / 4));
    const barWidth = (width - gap * (barCount - 1)) / barCount;
    // 高频段基本为空，取前 3/4 频域并对数式拉伸
    const usableBins = Math.floor(visualizer.data.length * 0.75);
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, "#8b5cf6");
    gradient.addColorStop(1, "#ec4899");
    ctx.fillStyle = gradient;

    for (let i = 0; i < barCount; i += 1) {
      const start = Math.floor(Math.pow(i / barCount, 1.6) * usableBins);
      const end = Math.max(start + 1, Math.floor(Math.pow((i + 1) / barCount, 1.6) * usableBins));
      let sum = 0;
      for (let bin = start; bin < end && bin < visualizer.data.length; bin += 1) {
        sum += visualizer.data[bin];
      }
      const average = sum / Math.max(1, end - start);
      const barHeight = Math.max(2, Math.round((average / 255) * (height - 2)));
      ctx.fillRect(i * (barWidth + gap), height - barHeight, barWidth, barHeight);
    }
  }

  function tick() {
    visualizer.raf = 0;
    if (!visualizer.canvas) return;
    if (!document.hidden) drawFrame();
    visualizer.raf = requestAnimationFrame(tick);
  }

  function attachVisualizer(canvas) {
    visualizer.canvas = canvas || null;
    visualizer.ctx2d = visualizer.canvas ? visualizer.canvas.getContext("2d") : null;
    if (visualizer.raf) {
      cancelAnimationFrame(visualizer.raf);
      visualizer.raf = 0;
    }
    if (!visualizer.canvas) return;
    drawIdleFrame();
    visualizer.raf = requestAnimationFrame(tick);
  }

  graph.el = new Audio();
  graph.el.preload = "auto";

  window.ClaudioEQ = {
    setBaseElement,
    currentElement,
    elements,
    prepare,
    migrate,
    isEnabled,
    enable,
    disable,
    setPreset,
    setGain,
    setPreamp,
    getState,
    restore,
    presets,
    bands,
    passthroughNotice,
    attachVisualizer
  };
})();
