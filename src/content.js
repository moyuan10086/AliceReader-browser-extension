(() => {
  const HOST_ID = "minmax-tts-host";
  const POSITION_KEY = "minmaxTtsPlayerPosition";
  const CURRENT_HIGHLIGHT = "minmax-tts-current-sentence";
  const QUEUE_HIGHLIGHT = "minmax-tts-selection";
  const DEFAULT_PANEL_SETTINGS = {
    autoHideOnDone: false
  };

  let host;
  let root;
  let bubble;
  let panel;
  let audio;
  let selectionRange = null;
  let selectedRawText = "";
  let selectedText = "";
  let sentenceItems = [];
  let currentIndex = 0;
  let audioObjectUrl = "";
  let lastAudioBlob = null;
  let lastAudioFilename = "alicereader-tts.mp3";
  let timelineItems = [];
  let selectionChangeTimer = 0;
  let isDragging = false;
  let isPlayingQueue = false;
  let isCancelled = false;
  let isSeeking = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let lastMeta = null;
  let pointerStartedInsideUi = false;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const labels = {
    ready: "\u5df2\u51c6\u5907",
    generating: "\u751f\u6210\u4e2d",
    playing: "\u8ddf\u8bfb\u4e2d",
    paused: "\u5df2\u6682\u505c",
    ended: "\u5df2\u5b8c\u6210",
    failed: "\u5931\u8d25",
    noSelection: "\u8bf7\u5148\u9009\u4e2d\u6587\u672c"
  };

  function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function captureSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    const raw = selection.toString();
    const text = normalizeText(raw);
    if (!text) return false;

    selectionRange = selection.getRangeAt(0).cloneRange();
    selectedRawText = raw;
    selectedText = text;
    sentenceItems = buildSentenceItems(raw, selectionRange);
    currentIndex = 0;
    return true;
  }

  function getParagraphTextFromSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";

    let node = selection.anchorNode;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const paragraph = node?.closest?.("p, li, blockquote, article, section, div");
    return normalizeText(paragraph?.innerText || selection.toString());
  }

  function ensureUi() {
    if (host && root && panel && bubble) return;
    const skin = {
      play: chrome.runtime.getURL("assets/skins/play.png"),
      pause: chrome.runtime.getURL("assets/skins/pause.png"),
      loading: chrome.runtime.getURL("assets/skins/loading.png"),
      done: chrome.runtime.getURL("assets/skins/done.png"),
      actionPlay: chrome.runtime.getURL("assets/skins/action-play.png"),
      actionPause: chrome.runtime.getURL("assets/skins/action-pause.png"),
      actionLoading: chrome.runtime.getURL("assets/skins/action-loading.png"),
      actionDone: chrome.runtime.getURL("assets/skins/action-done.png"),
      mascotReady: chrome.runtime.getURL("assets/player-mascot-ready.png"),
      mascotPlaying: chrome.runtime.getURL("assets/player-mascot-playing.png"),
      mascotPaused: chrome.runtime.getURL("assets/player-mascot-paused.png"),
      mascotLoading: chrome.runtime.getURL("assets/player-mascot-loading.png"),
      mascotDone: chrome.runtime.getURL("assets/player-mascot-done.png"),
      bubble: chrome.runtime.getURL("assets/bubble-avatar.png")
    };
    host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      document.documentElement.appendChild(host);
    }

    root = host.shadowRoot || host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host {
          all: initial;
          color-scheme: light;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .bubble {
          position: fixed;
          z-index: 2147483647;
          display: none;
          width: 48px;
          height: 48px;
          place-items: center;
          padding: 0;
          border: 0;
          border-radius: 999px;
          background: transparent;
          color: transparent;
          box-shadow: 0 10px 24px rgba(41, 138, 235, 0.22);
          backdrop-filter: blur(14px) saturate(1.2);
          -webkit-backdrop-filter: blur(14px) saturate(1.2);
          cursor: pointer;
          user-select: none;
          opacity: 0.96;
          transition: transform 140ms ease, opacity 140ms ease, filter 140ms ease;
        }

        .bubble.visible {
          display: grid;
        }

        .bubble:hover {
          transform: translateY(-1px) scale(1.03);
          opacity: 1;
          filter: drop-shadow(0 8px 16px rgba(31, 123, 243, 0.22));
        }

        .bubble-avatar {
          width: 48px;
          height: 48px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: transparent center / contain no-repeat;
          background-image: url("${skin.bubble}");
        }

        .player {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2147483647;
          width: min(348px, calc(100vw - 24px));
          display: none;
          overflow: hidden;
          border: 1px solid rgba(126, 199, 255, 0.72);
          border-radius: 12px;
          background:
            radial-gradient(circle at 12% 10%, rgba(184, 232, 255, 0.42), rgba(184, 232, 255, 0) 36%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.68), rgba(236, 248, 255, 0.58));
          color: #0b2a55;
          box-shadow: 0 18px 42px rgba(54, 132, 218, 0.16), 0 6px 16px rgba(31, 99, 178, 0.08), inset 0 1px 0 rgba(255,255,255,0.82);
          backdrop-filter: blur(18px) saturate(1.2);
          -webkit-backdrop-filter: blur(18px) saturate(1.2);
          user-select: none;
        }

        .player.visible {
          display: block;
        }

        .main {
          display: grid;
          grid-template-columns: 64px minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          min-height: 68px;
          padding: 9px 10px 8px 14px;
          cursor: grab;
          position: relative;
        }

        .main:active {
          cursor: grabbing;
        }

        .play {
          width: 50px;
          height: 50px;
          display: inline-grid;
          place-items: center;
          border: 0;
          border-radius: 999px;
          background: transparent;
          color: transparent;
          cursor: pointer;
          font: inherit;
          font-size: 0;
          line-height: 1;
          overflow: visible;
          position: relative;
          isolation: isolate;
        }

        .play::before {
          content: "";
          position: absolute;
          left: 50%;
          top: 48%;
          width: 82px;
          height: 82px;
          background: transparent center / contain no-repeat;
          background-image: url("${skin.mascotReady}");
          filter: drop-shadow(0 9px 15px rgba(28, 126, 235, 0.18));
          transform: translate(-50%, -50%);
          transform-origin: center;
          transition: filter 150ms ease, transform 150ms ease;
          z-index: 1;
          pointer-events: none;
        }

        .play::after {
          content: "";
          position: absolute;
          right: -16px;
          bottom: -12px;
          width: 44px;
          height: 44px;
          border-radius: 999px;
          background: transparent center / contain no-repeat;
          background-image: url("${skin.actionPlay}");
          filter: drop-shadow(0 8px 13px rgba(28, 126, 235, 0.28));
          z-index: 2;
          pointer-events: none;
        }

        .play:hover::before {
          filter: drop-shadow(0 12px 20px rgba(28, 126, 235, 0.28));
          transform: translate(-50%, -50%) scale(1.03);
        }

        .play.state-play::after { background-image: url("${skin.actionPlay}"); }
        .play.state-pause::after { background-image: url("${skin.actionPause}"); }
        .play.state-loading::after { background-image: url("${skin.actionLoading}"); }
        .play.state-done::after { background-image: url("${skin.actionDone}"); }

        .play.mood-ready::before { background-image: url("${skin.mascotReady}"); }
        .play.mood-playing::before { background-image: url("${skin.mascotPlaying}"); }
        .play.mood-paused::before { background-image: url("${skin.mascotPaused}"); }
        .play.mood-loading::before { background-image: url("${skin.mascotLoading}"); }
        .play.mood-done::before { background-image: url("${skin.mascotDone}"); }

        .play:disabled {
          cursor: wait;
          opacity: 0.86;
        }

        .play.state-loading::after {
          animation: minmax-tts-record 1.15s linear infinite;
        }

        .play.mood-loading::before {
          animation: minmax-tts-mascot-pulse 900ms ease-in-out infinite alternate;
          filter: drop-shadow(0 11px 20px rgba(72, 215, 255, 0.32));
        }

        .play.mood-done::before {
          filter: drop-shadow(0 10px 18px rgba(31, 208, 111, 0.28));
        }

        @keyframes minmax-tts-record {
          to { transform: rotate(360deg); }
        }

        @keyframes minmax-tts-mascot-pulse {
          from { transform: translate(-50%, -50%) scale(0.98); }
          to { transform: translate(-50%, -52%) scale(1.04); }
        }

        .copy {
          min-width: 0;
          align-self: center;
          display: grid;
          align-content: center;
        }

        .row {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
        }

        .brand {
          color: #1284ff;
          font-size: 13px;
          font-weight: 820;
          white-space: nowrap;
          text-shadow: 0 1px 0 rgba(255,255,255,0.85);
        }

        .status,
        .count {
          color: rgba(61, 81, 121, 0.74);
          font-size: 12px;
          font-weight: 650;
          white-space: nowrap;
        }

        .sentence {
          display: none;
        }

        .tools {
          display: flex;
          align-items: center;
          gap: 1px;
          z-index: 3;
        }

        .icon {
          width: 24px;
          height: 24px;
          display: inline-grid;
          place-items: center;
          border: 0;
          border-radius: 7px;
          background: transparent;
          color: #1976f4;
          cursor: pointer;
          font: inherit;
          font-size: 13px;
          line-height: 1;
        }

        .icon:hover {
          background: rgba(36, 151, 255, 0.12);
          color: #085dcc;
        }

        .spark {
          display: none;
          position: absolute;
          color: #39dfff;
          font-size: 17px;
          text-shadow: 0 0 10px rgba(57, 223, 255, 0.8);
          pointer-events: none;
        }

        .wave {
          display: flex;
          align-items: end;
          gap: 2px;
          height: 18px;
          margin-top: 8px;
          opacity: 0.9;
        }

        .wave span {
          width: 3px;
          height: 8px;
          border-radius: 99px;
          background: linear-gradient(180deg, #34c9ff, #207ef5);
        }

        .wave span:nth-child(2n) { height: 10px; opacity: .75; }
        .wave span:nth-child(3n) { height: 14px; opacity: .9; }
        .wave span:nth-child(5n) { height: 8px; opacity: .55; }

        .player.playing .wave span {
          animation: minmax-tts-wave 900ms ease-in-out infinite alternate;
        }

        .player.playing .wave span:nth-child(2n) { animation-delay: 80ms; }
        .player.playing .wave span:nth-child(3n) { animation-delay: 160ms; }
        .player.playing .wave span:nth-child(5n) { animation-delay: 240ms; }

        @keyframes minmax-tts-wave {
          from { transform: scaleY(0.72); opacity: .58; }
          to { transform: scaleY(1.22); opacity: 1; }
        }

        .progress {
          height: 14px;
          display: flex;
          align-items: center;
          padding: 0 14px 10px;
          background: transparent;
        }

        .bar {
          position: relative;
          width: 100%;
          height: 5px;
          border-radius: 999px;
          background: rgba(43, 145, 255, 0.14);
          cursor: pointer;
          overflow: visible;
        }

        .bar-fill {
          width: 0%;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #1b88ff, #8ff4ff);
          transition: width 120ms linear;
        }

        .bar-thumb {
          position: absolute;
          top: 50%;
          left: 0%;
          width: 13px;
          height: 13px;
          border-radius: 999px;
          background: #1b88ff;
          box-shadow: 0 2px 8px rgba(27, 136, 255, 0.42), 0 0 0 3px rgba(255,255,255,0.92);
          transform: translate(-50%, -50%);
          transition: left 120ms linear;
        }

        .drawer {
          display: none;
          padding: 0 14px 12px;
        }

        .player.has-error .drawer {
          display: block;
        }

        .meta,
        .error {
          margin-top: 0;
          color: rgba(49, 70, 106, 0.72);
          font-size: 11px;
          line-height: 1.45;
          word-break: break-all;
        }

        .error {
          display: none;
          padding: 8px 10px;
          border-radius: 7px;
          background: rgba(255, 231, 231, 0.9);
          color: #bf1234;
          font-size: 13px;
        }

        .meta {
          display: none;
        }

        .player.has-error .meta {
          display: block;
          margin-bottom: 7px;
        }

        .player.has-error .error {
          display: block;
        }

        audio {
          display: none;
        }
      </style>
      <button class="bubble" type="button" aria-label="Read selection">
        <span class="bubble-avatar" aria-hidden="true"></span>
      </button>
      <section class="player" aria-label="MiniMax TTS mini player">
        <div class="main">
          <button class="play state-play" type="button" aria-label="Play or pause">&#9654;</button>
          <div class="copy">
            <div class="row">
              <span class="brand">AliceReader</span>
              <span class="status">${labels.ready}</span>
              <span class="count">0/0</span>
            </div>
            <div class="sentence">Selection</div>
            <div class="wave" aria-hidden="true">
              <span></span><span></span><span></span><span></span><span></span>
              <span></span><span></span><span></span><span></span><span></span>
              <span></span><span></span>
            </div>
          </div>
          <span class="spark">&#10022;</span>
          <div class="tools">
            <button class="icon replay" type="button" aria-label="Replay" title="Replay">&#8635;</button>
            <button class="icon download" type="button" aria-label="Download audio" title="Download audio">&#8681;</button>
            <button class="icon options" type="button" aria-label="Settings" title="Settings">&#9881;</button>
            <button class="icon close" type="button" aria-label="Close" title="Close">&#215;</button>
          </div>
        </div>
        <div class="progress"><div class="bar"><div class="bar-fill"></div><div class="bar-thumb"></div></div></div>
        <div class="drawer">
          <div class="meta"></div>
          <div class="error"></div>
        </div>
        <audio class="audio"></audio>
      </section>
    `;

    bubble = root.querySelector(".bubble");
    panel = root.querySelector(".player");
    audio = root.querySelector(".audio");
    bindEvents();
    restorePosition();
  }

  function bindEvents() {
    const main = root.querySelector(".main");
    root.querySelector(".bubble").addEventListener("click", () => startQueueFromSelection());
    root.querySelector(".close").addEventListener("click", hidePlayer);
    root.querySelector(".play").addEventListener("click", onPrimaryAction);
    root.querySelector(".replay").addEventListener("click", replayQueue);
    root.querySelector(".download").addEventListener("click", downloadAudioSafe);
    root.querySelector(".options").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "MINMAX_TTS_OPEN_OPTIONS" });
    });

    main.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;

      isDragging = true;
      const rect = panel.getBoundingClientRect();
      dragOffsetX = event.clientX - rect.left;
      dragOffsetY = event.clientY - rect.top;
      main.setPointerCapture(event.pointerId);
    });

    main.addEventListener("pointermove", (event) => {
      if (!isDragging) return;
      placePanel(event.clientX - dragOffsetX, event.clientY - dragOffsetY);
    });

    main.addEventListener("pointerup", () => {
      isDragging = false;
      savePosition();
    });

    audio.addEventListener("timeupdate", updateAudioProgress);
    audio.addEventListener("loadedmetadata", updateAudioProgress);
    audio.addEventListener("ended", onAudioEnded);

    const bar = root.querySelector(".bar");
    bar.addEventListener("pointerdown", (event) => {
      if (!audio.duration) return;
      isSeeking = true;
      bar.setPointerCapture(event.pointerId);
      seekFromPointer(event);
    });
    bar.addEventListener("pointermove", (event) => {
      if (isSeeking) seekFromPointer(event);
    });
    bar.addEventListener("pointerup", () => {
      isSeeking = false;
    });
  }

  function buildSentenceItems(rawText, baseRange) {
    const textIndex = buildTextIndex(baseRange);
    const sourceText = textIndex.text || rawText;
    const items = [];
    for (const segment of splitSentencesSafe(sourceText)) {
      const trimmed = normalizeText(segment.text);
      if (!trimmed) continue;

      items.push({
        text: trimmed,
        range: createRangeFromOffsets(textIndex, segment.start, segment.end)
      });
    }

    if (!items.length) {
      items.push({ text: normalizeText(sourceText), range: baseRange.cloneRange() });
    }
    return items;
  }

  function buildPlainSentenceItems(text) {
    const items = [];
    for (const segment of splitSentencesSafe(text)) {
      const trimmed = normalizeText(segment.text);
      if (trimmed) items.push({ text: trimmed, range: null });
    }

    return items.length ? items : [{ text: normalizeText(text), range: null }];
  }

  function splitSentences(text) {
    const segments = [];
    let start = 0;
    let index = 0;

    while (index < text.length) {
      const char = text[index];
      if (isSentenceEnd(text, index)) {
        let end = index + 1;
        while (end < text.length && /["')\]\}\u201d\u2019\u300b\uff09\u3011\s]/.test(text[end])) {
          end += 1;
        }
        while (end < text.length && /["')\]\}”’》）】\s]/.test(text[end])) {
          end += 1;
        }
        pushSegment(segments, text, start, end);
        start = end;
        index = end;
        continue;
      }
      index += 1;
    }

    pushSegment(segments, text, start, text.length);
    return segments;
  }

  function splitSentencesSafe(text) {
    const segments = [];
    let start = 0;
    let index = 0;

    while (index < text.length) {
      if (isSentenceEnd(text, index)) {
        let end = index + 1;
        while (end < text.length && /["')\]\}\u201d\u2019\u300b\uff09\u3011\s]/.test(text[end])) {
          end += 1;
        }
        pushSegment(segments, text, start, end);
        start = end;
        index = end;
        continue;
      }
      index += 1;
    }

    pushSegment(segments, text, start, text.length);
    return segments;
  }

  function isSentenceEnd(text, index) {
    const char = text[index];
    if (char === "\u3002" || char === "\uff01" || char === "\uff1f" || char === "!" || char === "?") {
      return true;
    }
    if (char !== ".") return false;

    const prev = text[index - 1] || "";
    const next = text[index + 1] || "";
    if (/\d/.test(prev) && /\d/.test(next)) return false;
    if (/[A-Za-z]/.test(prev) && /[A-Za-z]/.test(next)) return false;
    return true;
  }

  function pushSegment(segments, text, rawStart, rawEnd) {
    let start = rawStart;
    let end = rawEnd;
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    if (end > start) {
      segments.push({ text: text.slice(start, end), start, end });
    }
  }

  function buildTextIndex(baseRange) {
    const rootNode = baseRange.commonAncestorContainer;
    const owner = rootNode.nodeType === Node.TEXT_NODE ? rootNode.parentNode : rootNode;
    const walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return baseRange.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    const parts = [];
    let cursor = 0;
    let text = "";
    let node;
    while ((node = walker.nextNode())) {
      const start = node === baseRange.startContainer ? baseRange.startOffset : 0;
      const end = node === baseRange.endContainer ? baseRange.endOffset : node.nodeValue.length;
      if (end <= start) continue;
      const slice = node.nodeValue.slice(start, end);
      const length = end - start;
      parts.push({ node, start, end, from: cursor, to: cursor + length });
      text += slice;
      cursor += length;
    }
    parts.text = text;
    return parts;
  }

  function createRangeFromOffsets(index, start, end) {
    const range = document.createRange();
    const first = index.find((part) => start >= part.from && start < part.to) || index[0];
    const last = index.find((part) => end > part.from && end <= part.to) || index[index.length - 1];
    if (!first || !last) return null;

    range.setStart(first.node, first.start + Math.max(0, start - first.from));
    range.setEnd(last.node, last.start + Math.max(0, end - last.from));
    return range;
  }

  function showBubble() {
    ensureUi();
    const rect = selectionRange?.getBoundingClientRect?.();
    if (!rect) return;

    bubble.classList.add("visible");
    const bubbleWidth = 48;
    const leftCandidate = rect.right + 12;
    const fallbackLeft = rect.left - bubbleWidth - 10;
    const left = leftCandidate < window.innerWidth - bubbleWidth - 12 ? leftCandidate : fallbackLeft;
    bubble.style.left = `${clamp(left, 8, window.innerWidth - bubbleWidth - 8)}px`;
    bubble.style.top = `${clamp(rect.bottom + 6, 8, window.innerHeight - 56)}px`;
    window.setTimeout(() => avoidFloatingToolbars(rect), 120);
    renderPlayerText();
    setQueueHighlight();
  }

  function avoidFloatingToolbars(selectionRect) {
    if (!bubble?.classList.contains("visible")) return;
    const bubbleRect = bubble.getBoundingClientRect();
    const elements = document.elementsFromPoint(
      bubbleRect.left + bubbleRect.width / 2,
      bubbleRect.top + bubbleRect.height / 2
    );
    const blocked = elements.some((element) => {
      if (host.contains(element)) return false;
      const style = window.getComputedStyle(element);
      const z = Number(style.zIndex);
      return ["fixed", "sticky", "absolute"].includes(style.position) && (Number.isFinite(z) ? z > 100 : true);
    });
    if (!blocked) return;

    const nextLeft = selectionRect.right + 10;
    const nextTop = selectionRect.bottom + 38;
    bubble.style.left = `${clamp(nextLeft, 8, window.innerWidth - bubbleRect.width - 8)}px`;
    bubble.style.top = `${clamp(nextTop, 8, window.innerHeight - bubbleRect.height - 8)}px`;
  }

  function hideBubble() {
    bubble?.classList.remove("visible");
  }

  function showPlayer() {
    ensureUi();
    hideBubble();
    panel.classList.add("visible");
    clearError();
    renderPlayerText();
  }

  function hidePlayer() {
    cancelQueue();
    clearHighlights();
    panel?.classList.remove("visible");
  }

  function restorePosition() {
    try {
      const raw = localStorage.getItem(POSITION_KEY);
      if (!raw) return;
      const position = JSON.parse(raw);
      if (Number.isFinite(position.left) && Number.isFinite(position.top)) {
        placePanel(position.left, position.top);
      }
    } catch {
      try {
        localStorage.removeItem(POSITION_KEY);
      } catch {
        // Some pages, such as about:blank and sandboxed frames, block storage access.
      }
    }
  }

  function savePosition() {
    try {
      const rect = panel.getBoundingClientRect();
      localStorage.setItem(POSITION_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
    } catch {
      // Position persistence is optional.
    }
  }

  function placePanel(left, top) {
    const rect = panel.getBoundingClientRect();
    const width = rect.width || 316;
    const height = rect.height || 62;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.left = `${clamp(left, 10, window.innerWidth - width - 10)}px`;
    panel.style.top = `${clamp(top, 10, window.innerHeight - height - 10)}px`;
  }

  function renderPlayerText() {
    const item = sentenceItems[currentIndex] || sentenceItems[0];
    root.querySelector(".sentence").textContent = item?.text || selectedText || "Selection";
    root.querySelector(".count").textContent = sentenceItems.length ? `${currentIndex + 1}/${sentenceItems.length}` : "0/0";
    renderMeta();
    updateOverallProgress();
  }

  function setStatus(text) {
    const status = root?.querySelector(".status");
    if (status) status.textContent = text;
  }

  function setPlayIcon(isPlaying) {
    const play = root?.querySelector(".play");
    if (!play) return;
    play.classList.remove("state-play", "state-pause", "state-loading", "state-done");
    play.classList.add(isPlaying ? "state-pause" : "state-play");
    setMascotMood(isPlaying ? "playing" : "paused");
  }

  function setPlayState(state) {
    const play = root?.querySelector(".play");
    if (!play) return;
    play.classList.remove("state-play", "state-pause", "state-loading", "state-done");
    play.classList.add(`state-${state}`);
    const moodByState = {
      play: "ready",
      pause: "playing",
      loading: "loading",
      done: "done"
    };
    setMascotMood(moodByState[state] || "ready");
  }

  function setMascotMood(mood) {
    const play = root?.querySelector(".play");
    if (!play) return;
    play.classList.remove("mood-ready", "mood-playing", "mood-paused", "mood-loading", "mood-done");
    play.classList.add(`mood-${mood}`);
  }

  function setBusy(isBusy) {
    const play = root?.querySelector(".play");
    if (play) play.disabled = isBusy;
  }

  function renderMeta() {
    const meta = root?.querySelector(".meta");
    if (!meta) return;
    const bits = [];
    if (lastMeta?.provider) bits.push(`channel: ${lastMeta.provider}`);
    if (lastMeta?.model) bits.push(`model: ${lastMeta.model}`);
    if (lastMeta?.cache) bits.push(lastMeta.cache === "hit" ? "cache hit" : "new audio");
    if (lastMeta?.sourceKind) bits.push(`source: ${lastMeta.sourceKind}`);
    if (lastMeta?.traceId) bits.push(`trace: ${lastMeta.traceId}`);
    if (lastMeta?.audioLength) bits.push(`audio: ${lastMeta.audioLength}ms`);
    if (lastMeta?.timelineCount) bits.push(`timeline: ${lastMeta.timelineCount}`);
    if (lastMeta?.usageCharacters) bits.push(`chars: ${lastMeta.usageCharacters}`);
    meta.textContent = bits.length ? bits.join(" / ") : "No TTS response yet.";
  }

  function showError(message) {
    panel?.classList.add("has-error");
    const error = root?.querySelector(".error");
    if (error) error.textContent = message || "Unknown error.";
  }

  function clearError() {
    panel?.classList.remove("has-error");
    const error = root?.querySelector(".error");
    if (error) error.textContent = "";
  }

  async function onPrimaryAction() {
    if (audio?.src && !audio.paused) {
      audio.pause();
      setStatus(labels.paused);
      setPlayIcon(false);
      panel?.classList.remove("playing");
      return;
    }

    if (audio?.src && audio.paused) {
      const total = getEffectiveDuration();
      const shouldReplay = audio.ended || (total > 0 && audio.currentTime >= total - 0.05);
      if (shouldReplay) {
        audio.currentTime = 0;
        currentIndex = 0;
        updateOverallProgress(0);
        renderPlayerText();
        highlightCurrentSentence();
      }
      isPlayingQueue = true;
      await playAudio();
      return;
    }
    await startQueueFromSelection();
  }

  async function startQueueFromSelection() {
    if (!sentenceItems.length && !captureSelection()) {
      showPlayer();
      showError(labels.noSelection);
      return;
    }

    showPlayer();
    window.getSelection()?.removeAllRanges();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await playQueue(0);
  }

  async function replayQueue() {
    if (!sentenceItems.length) return;
    if (audio.src) {
      audio.currentTime = 0;
      currentIndex = 0;
      highlightCurrentSentence();
      await playAudio();
      return;
    }
    await playQueue(0);
  }

  async function playQueue(startIndex) {
    cancelAudioOnly();
    timelineItems = [];
    isCancelled = false;
    isPlayingQueue = true;
    setBusy(true);
    currentIndex = Math.max(0, startIndex);
    renderPlayerText();
    highlightCurrentSentence();
    setStatus(labels.generating);
    setPlayState("loading");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "MINMAX_TTS_SYNTHESIZE",
        text: selectedText
      });

      if (!response?.ok) {
        throw new Error(response?.error || "MiniMax TTS failed.");
      }

      lastMeta = response.meta || null;
      timelineItems = alignTimeline(response.timeline || []);
      renderMeta();
      audio.src = makeAudioSource(response);
      await playAudio();
    } catch (error) {
      setStatus(labels.failed);
      showError(error.message || String(error));
      setPlayState("play");
      panel?.classList.remove("playing");
      isPlayingQueue = false;
    } finally {
      setBusy(false);
    }
  }

  async function playAudio() {
    try {
      await audio.play();
      setStatus(labels.playing);
      setPlayIcon(true);
      panel?.classList.add("playing");
    } catch (error) {
      showError(error.message || String(error));
      setStatus(labels.failed);
      setPlayIcon(false);
      panel?.classList.remove("playing");
      throw error;
    }
  }

  function waitForAudioEnd() {
    return new Promise((resolve) => {
      const finish = () => {
        audio.removeEventListener("ended", finish);
        audio.removeEventListener("error", finish);
        resolve();
      };
      audio.addEventListener("ended", finish);
      audio.addEventListener("error", finish);
    });
  }

  async function onAudioEnded() {
    isPlayingQueue = false;
    setStatus(labels.ended);
    setPlayState("done");
    panel?.classList.remove("playing");
    updateOverallProgress(100);
    clearCurrentHighlight();
    if ((await getPanelSettings()).autoHideOnDone) {
      window.setTimeout(() => hidePlayer(), 650);
    }
  }

  function readParagraph() {
    const paragraphText = getParagraphTextFromSelection();
    if (!paragraphText) {
      showError(labels.noSelection);
      return;
    }
    selectedRawText = paragraphText;
    selectedText = paragraphText;
    sentenceItems = buildPlainSentenceItems(paragraphText);
    showPlayer();
    playQueue(0);
  }

  function cancelQueue() {
    isCancelled = true;
    isPlayingQueue = false;
    cancelAudioOnly();
    setPlayState("play");
    setStatus(labels.ready);
    panel?.classList.remove("playing");
  }

  function cancelAudioOnly() {
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (audioObjectUrl) {
      URL.revokeObjectURL(audioObjectUrl);
      audioObjectUrl = "";
    }
    lastAudioBlob = null;
    timelineItems = [];
    panel?.classList.remove("playing");
  }

  function makeAudioSource(response) {
    if (!response.audioBase64) {
      throw new Error("MiniMax did not return hex audio. Check output_format and API response.");
    }

    const binary = atob(response.audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
    lastAudioBlob = new Blob([bytes], { type: response.audioMime || "audio/mpeg" });
    lastAudioFilename = makeDownloadName();
    audioObjectUrl = URL.createObjectURL(lastAudioBlob);
    return audioObjectUrl;
  }

  function cleanComparableText(text) {
    return normalizeText(String(text || "").replace(/[^\p{L}\p{N}]+/gu, " ")).toLowerCase();
  }

  function textTokens(text) {
    const cleaned = cleanComparableText(text);
    if (!cleaned) return [];
    const words = cleaned.match(/[\p{Script=Han}]|[\p{L}\p{N}]+/gu);
    return words || [];
  }

  function tokenOverlapScore(left, right) {
    if (!left.length || !right.length) return 0;
    const counts = new Map();
    for (const token of left) counts.set(token, (counts.get(token) || 0) + 1);
    let overlap = 0;
    for (const token of right) {
      const count = counts.get(token) || 0;
      if (count > 0) {
        overlap += 1;
        counts.set(token, count - 1);
      }
    }
    return overlap / Math.max(left.length, right.length);
  }

  function bestSentenceIndexForTimelineText(text, fallbackIndex) {
    const rowTokens = textTokens(text);
    if (!rowTokens.length) return fallbackIndex;

    let bestIndex = fallbackIndex;
    let bestScore = 0;
    sentenceItems.forEach((item, index) => {
      const score = tokenOverlapScore(rowTokens, textTokens(item.text));
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return bestScore >= 0.32 ? bestIndex : fallbackIndex;
  }

  function alignTimeline(timeline) {
    const rows = Array.isArray(timeline) ? timeline : [];
    if (!rows.length || !sentenceItems.length) return [];

    const buckets = sentenceItems.map((item, sentenceIndex) => ({
      start: Number.POSITIVE_INFINITY,
      end: 0,
      text: item.text,
      sentenceIndex
    }));

    rows
      .map((row) => ({
        start: Number(row.start),
        end: Number(row.end),
        text: String(row.text || "")
      }))
      .filter((row) => Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start)
      .sort((a, b) => a.start - b.start)
      .forEach((row, rowIndex) => {
        const fallbackIndex = clamp(rowIndex, 0, sentenceItems.length - 1);
        const sentenceIndex = bestSentenceIndexForTimelineText(row.text, fallbackIndex);
        const bucket = buckets[sentenceIndex];
        bucket.start = Math.min(bucket.start, row.start);
        bucket.end = Math.max(bucket.end, row.end);
      });

    const aligned = buckets.filter((item) => item.end > item.start);
    if (!aligned.length) return [];

    for (let i = 0; i < aligned.length - 1; i += 1) {
      const current = aligned[i];
      const next = aligned[i + 1];
      if (current.end > next.start) {
        const midpoint = (current.end + next.start) / 2;
        current.end = midpoint;
        next.start = midpoint;
      }
    }

    return aligned.sort((a, b) => a.start - b.start);
  }

  function indexFromTimeline(now) {
    if (!timelineItems.length) return -1;
    const active = timelineItems.find((item) => now >= item.start && now < item.end);
    if (active) return active.sentenceIndex;

    let previous = timelineItems[0];
    for (const item of timelineItems) {
      if (item.start > now) break;
      previous = item;
    }
    return previous?.sentenceIndex ?? -1;
  }

  function getEffectiveDuration() {
    const duration = Number(audio?.duration || 0);
    if (Number.isFinite(duration) && duration > 0) return duration;

    const timelineEnd = timelineItems.length
      ? Math.max(...timelineItems.map((item) => Number(item.end) || 0))
      : 0;
    if (Number.isFinite(timelineEnd) && timelineEnd > 0) return timelineEnd;

    const metaLength = Number(lastMeta?.audioLength || 0);
    return Number.isFinite(metaLength) && metaLength > 0 ? metaLength / 1000 : 0;
  }

  function updateAudioProgress() {
    const total = getEffectiveDuration();
    const now = audio?.currentTime || 0;
    const fraction = total ? clamp(now / total, 0, 1) : 0;
    const timelineIndex = indexFromTimeline(now);
    const nextIndex = timelineIndex >= 0
      ? timelineIndex
      : sentenceItems.length ? clamp(Math.floor(fraction * sentenceItems.length), 0, sentenceItems.length - 1) : 0;
    if (nextIndex !== currentIndex) {
      currentIndex = nextIndex;
      renderPlayerText();
      highlightCurrentSentence();
    }
    const percent = fraction * 100;
    updateOverallProgress(percent);
  }

  function updateOverallProgress(value) {
    const fill = root?.querySelector(".bar-fill");
    const thumb = root?.querySelector(".bar-thumb");
    if (!fill || !thumb) return;
    const percent = Number.isFinite(value)
      ? value
      : sentenceItems.length ? (currentIndex / sentenceItems.length) * 100 : 0;
    const clamped = clamp(percent, 0, 100);
    fill.style.width = `${clamped}%`;
    thumb.style.left = `${clamped}%`;
  }

  function seekFromPointer(event) {
    const bar = root?.querySelector(".bar");
    const total = getEffectiveDuration();
    if (!bar || !total) return;
    const rect = bar.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    audio.currentTime = ratio * total;
    updateAudioProgress();
  }

  function downloadAudioSafe() {
    if (!lastAudioBlob) {
      showError("\u8bf7\u5148\u751f\u6210\u97f3\u9891\u540e\u518d\u4e0b\u8f7d\u3002");
      return;
    }
    const url = URL.createObjectURL(lastAudioBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = lastAudioFilename;
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function downloadAudio() {
    if (!lastAudioBlob) {
      showError("请先生成音频后再下载。");
      return;
    }
    const url = URL.createObjectURL(lastAudioBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = lastAudioFilename;
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function makeDownloadName() {
    const base = (selectedText || "alicereader")
      .slice(0, 24)
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, "-") || "alicereader";
    return `${base}.mp3`;
  }

  function setQueueHighlight() {
    if (!("Highlight" in window) || !window.CSS?.highlights || !selectionRange) return;
    window.CSS.highlights.set(QUEUE_HIGHLIGHT, new Highlight(selectionRange));
  }

  function highlightCurrentSentence() {
    clearCurrentHighlight();
    const range = sentenceItems[currentIndex]?.range;
    if (!range) return;

    if ("Highlight" in window && window.CSS?.highlights) {
      window.CSS.highlights.set(CURRENT_HIGHLIGHT, new Highlight(range));
    }
    range.startContainer?.parentElement?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  function clearCurrentHighlight() {
    window.CSS?.highlights?.delete?.(CURRENT_HIGHLIGHT);
  }

  function clearHighlights() {
    clearCurrentHighlight();
    window.CSS?.highlights?.delete?.(QUEUE_HIGHLIGHT);
  }

  async function getPanelSettings() {
    try {
      const stored = await chrome.storage.local.get({ panel: DEFAULT_PANEL_SETTINGS });
      return { ...DEFAULT_PANEL_SETTINGS, ...(stored.panel || {}) };
    } catch {
      return { ...DEFAULT_PANEL_SETTINGS };
    }
  }

  document.addEventListener("mouseup", () => {
    window.setTimeout(() => {
      if (pointerStartedInsideUi) {
        pointerStartedInsideUi = false;
        return;
      }
      if (captureSelection()) {
        showBubble();
      } else if (!isPlayingQueue && !panel?.classList.contains("visible")) {
        hideBubble();
        clearHighlights();
      }
    }, 0);
  });

  document.addEventListener("selectionchange", () => {
    window.clearTimeout(selectionChangeTimer);
    selectionChangeTimer = window.setTimeout(() => {
      const text = normalizeText(window.getSelection()?.toString() || "");
      if (!text && !isPlayingQueue && !panel?.classList.contains("visible")) {
        hideBubble();
        clearHighlights();
      }
    }, 80);
  });

  document.addEventListener("pointerdown", (event) => {
    pointerStartedInsideUi = event.composedPath().includes(host);
    if (!pointerStartedInsideUi && !isPlayingQueue) {
      hideBubble();
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.altKey && event.shiftKey && event.code === "KeyS") {
      event.preventDefault();
      startQueueFromSelection();
    }

    if (event.key === "Escape") {
      hideBubble();
      hidePlayer();
    }
  });

  chrome.runtime?.onMessage?.addListener?.((message) => {
    if (message?.type === "MINMAX_TTS_READ_SELECTION") {
      startQueueFromSelection();
    }
  });

  ensureUi();
})();
