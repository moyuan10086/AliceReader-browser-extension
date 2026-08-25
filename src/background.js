const DEFAULT_MINIMAX_SETTINGS = {
  endpoint: "https://api.minimaxi.com/v1/t2a_v2",
  model: "speech-2.8-turbo",
  voiceId: "English_expressive_narrator",
  speed: 1,
  volume: 1,
  pitch: 0,
  emotion: "fluent",
  languageBoost: "English",
  sampleRate: 32000,
  bitrate: 128000
};

const DEFAULT_PROVIDER = "minimax";
const DEFAULT_DOUBAO_SETTINGS = {
  endpoint: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
  model: "seed-tts-2.0",
  voiceId: "zh_female_vv_uranus_bigtts",
  sampleRate: 24000
};
const DEFAULT_ALIBABA_SETTINGS = {
  endpoint: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
  model: "qwen3-tts-flash",
  voiceId: "Cherry",
  languageType: "Chinese",
  languageHint: "",
  instruction: "",
  rate: 1,
  volume: 50,
  pitch: 1,
  sampleRate: 24000,
  format: "mp3"
};
const CACHE_MAX_ENTRIES = 12;
const CACHE_MAX_BYTES = 3 * 1024 * 1024;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "minmax-tts-read-selection",
    title: "Read selected text aloud",
    contexts: ["selection"]
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

async function sendReadSelection(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "MINMAX_TTS_READ_SELECTION" });
  } catch {
    chrome.runtime.openOptionsPage();
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "minmax-tts-read-selection" && tab?.id) {
    sendReadSelection(tab.id);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "read-selection") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    sendReadSelection(tab.id);
  }
});

function hexToBase64(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function isHexAudio(value) {
  return typeof value === "string" && value.length > 32 && value.length % 2 === 0 && /^[\da-f]+$/i.test(value);
}

function resolveAudioResult(result) {
  const audio = result?.data?.audio;
  if (!audio) {
    throw new Error("MiniMax response did not contain data.audio.");
  }

  if (/^https?:\/\//i.test(audio) || /^data:audio\//i.test(audio)) {
    return { audioUrl: audio };
  }

  if (isHexAudio(audio)) {
    return {
      audioBase64: hexToBase64(audio),
      audioMime: "audio/mpeg"
    };
  }

  throw new Error(`Unsupported MiniMax audio payload: ${String(audio).slice(0, 80)}`);
}

function parseTimestamp(value) {
  const match = String(value).trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/);
  if (!match) return 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const millis = Number(String(match[4] || "0").padEnd(3, "0").slice(0, 3));
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function normalizeSubtitleRows(rows) {
  const normalized = rows
    .map((row) => ({
      start: Number(row.start ?? row.start_time ?? row.begin ?? row.from ?? 0),
      end: Number(row.end ?? row.end_time ?? row.stop ?? row.to ?? 0),
      text: String(row.text ?? row.sentence ?? row.word ?? row.content ?? "").trim()
    }))
    .filter((row) => Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start && row.text);

  const maxEnd = Math.max(0, ...normalized.map((row) => row.end));
  const medianDuration = normalized
    .map((row) => row.end - row.start)
    .sort((a, b) => a - b)[Math.floor(normalized.length / 2)] || 0;
  const scale = maxEnd > 120 || medianDuration > 20 ? 1000 : 1;

  return normalized.map((row) => ({
    start: row.start / scale,
    end: row.end / scale,
    text: row.text
  }));
}

function parseSubtitleText(text) {
  const source = String(text || "").trim();
  if (!source) return [];

  try {
    const parsed = JSON.parse(source);
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed?.segments || parsed?.subtitles || parsed?.sentences || parsed?.words || [];
    if (Array.isArray(rows)) return normalizeSubtitleRows(rows);
  } catch {
    // Continue with VTT/SRT parsing.
  }

  const blocks = source
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const timeline = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex === -1) continue;
    const [startRaw, endRaw] = lines[timeLineIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const row = {
      start: parseTimestamp(startRaw),
      end: parseTimestamp(endRaw),
      text: lines.slice(timeLineIndex + 1).join(" ").trim()
    };
    if (row.end > row.start && row.text) timeline.push(row);
  }
  return timeline;
}

async function resolveSubtitleTimeline(result) {
  const inline = result?.data?.subtitle || result?.data?.subtitles || result?.data?.subtitle_content;
  if (inline) {
    const rows = Array.isArray(inline) ? normalizeSubtitleRows(inline) : parseSubtitleText(inline);
    if (rows.length) return rows;
  }

  const subtitleFile = result?.data?.subtitle_file;
  if (!subtitleFile || !/^https?:\/\//i.test(subtitleFile)) return [];

  try {
    const response = await fetch(subtitleFile);
    if (!response.ok) return [];
    return parseSubtitleText(await response.text());
  } catch {
    return [];
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const array = new Uint8Array(bytes);
  for (let i = 0; i < array.length; i += 0x8000) binary += String.fromCharCode(...array.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function cacheKey(provider, text, settings) {
  const source = JSON.stringify({ provider, text, settings });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return `aliceTtsCache:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function readCache(key) {
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key];
  if (!entry?.audioBase64) return null;
  return entry;
}

async function writeCache(key, entry) {
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all)
    .filter(([name, value]) => name.startsWith("aliceTtsCache:") && value?.audioBase64)
    .sort((a, b) => Number(a[1].createdAt || 0) - Number(b[1].createdAt || 0));
  let total = entries.reduce((sum, [, value]) => sum + String(value.audioBase64).length, 0) + entry.audioBase64.length;
  while (entries.length >= CACHE_MAX_ENTRIES || total > CACHE_MAX_BYTES) {
    const oldest = entries.shift();
    if (!oldest) break;
    total -= String(oldest[1].audioBase64 || "").length;
    await chrome.storage.local.remove(oldest[0]);
  }
  await chrome.storage.local.set({ [key]: { ...entry, createdAt: Date.now() } });
}

async function synthesizeWithDoubao(text) {
  const stored = await chrome.storage.local.get({ doubaoApiKey: "", doubao: DEFAULT_DOUBAO_SETTINGS });
  const apiKey = String(stored.doubaoApiKey || "").trim();
  const settings = { ...DEFAULT_DOUBAO_SETTINGS, ...(stored.doubao || {}) };
  if (!apiKey) throw new Error("请先在扩展设置页填写豆包 Speech API Key。");
  const response = await fetch(settings.endpoint, { method: "POST", headers: {
    "Content-Type": "application/json", "X-Api-Key": apiKey,
    "X-Api-Resource-Id": settings.model, "X-Api-Request-Id": crypto.randomUUID()
  }, body: JSON.stringify({ req_params: { text, speaker: settings.voiceId, audio_params: { format: "mp3", sample_rate: Number(settings.sampleRate) } } }) });
  if (!response.ok) throw new Error(`豆包 TTS HTTP ${response.status}`);
  const chunks = [];
  const reader = response.body?.getReader();
  if (!reader) throw new Error("豆包 TTS 未返回流式音频。");
  const decoder = new TextDecoder(); let buffer = "";
  while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ""; for (const line of lines) { if (!line.trim()) continue; const item = JSON.parse(line); if (item.code > 0 && item.code !== 20000000) throw new Error(item.message || `豆包 TTS 错误 ${item.code}`); if (item.data) chunks.push(item.data); } }
  if (!chunks.length) throw new Error("豆包 TTS 未返回音频数据。");
  const bytes = [];
  for (const chunk of chunks) {
    const binary = atob(chunk);
    for (let i = 0; i < binary.length; i += 1) bytes.push(binary.charCodeAt(i));
  }
  return { audioBase64: bytesToBase64(bytes), audioMime: "audio/mpeg", meta: { provider: "doubao", model: settings.model } };
}

async function synthesizeWithAlibaba(text) {
  const stored = await chrome.storage.local.get({ alibabaApiKey: "", alibaba: DEFAULT_ALIBABA_SETTINGS });
  const apiKey = String(stored.alibabaApiKey || "").trim();
  const settings = { ...DEFAULT_ALIBABA_SETTINGS, ...(stored.alibaba || {}) };
  if (!apiKey) throw new Error("请先在扩展设置页填写阿里百炼 API Key。");
  const isCosyVoice = /^cosyvoice-/i.test(settings.model) || /^qwen-audio-/i.test(settings.model);
  const endpoint = isCosyVoice ? "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer" : settings.endpoint;
  const input = isCosyVoice
    ? {
        text,
        voice: /^long[a-z]+(?:_v3)?$/i.test(String(settings.voiceId || "")) ? settings.voiceId : "longanhuan_v3",
        format: settings.format || "mp3",
        sample_rate: Number(settings.sampleRate) || 24000,
        rate: Number(settings.rate) || 1,
        volume: Number(settings.volume) || 50,
        pitch: Number(settings.pitch) || 1
      }
    : { text, voice: settings.voiceId, language_type: settings.languageType || "Auto" };
  if (isCosyVoice && settings.languageHint) input.language_hints = [settings.languageHint];
  if (isCosyVoice && settings.instruction) input.instruction = settings.instruction;
  if (!isCosyVoice && settings.instruction && settings.model === "qwen3-tts-instruct-flash") {
    input.instructions = settings.instruction;
    input.optimize_instructions = true;
  }
  const response = await fetch(endpoint, { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: settings.model, input }) });
  const result = await response.json();
  if (!response.ok || result.code) throw new Error(result.message || `阿里 TTS HTTP ${response.status}`);
  const url = result.output?.audio?.url || result.output?.audio_url;
  if (!url) throw new Error("阿里百炼未返回音频 URL。");
  const audioResponse = await fetch(url); if (!audioResponse.ok) throw new Error("阿里音频下载失败。");
  const format = input.format || "mp3";
  const audioMime = format === "wav" ? "audio/wav" : format === "opus" ? "audio/opus" : "audio/mpeg";
  return { audioBase64: bytesToBase64(await audioResponse.arrayBuffer()), audioMime, meta: { provider: "alibaba", model: settings.model, traceId: result.request_id } };
}

async function synthesizeWithProvider(text) {
  const stored = await chrome.storage.local.get({ provider: DEFAULT_PROVIDER, minimax: DEFAULT_MINIMAX_SETTINGS, doubao: DEFAULT_DOUBAO_SETTINGS, alibaba: DEFAULT_ALIBABA_SETTINGS });
  const provider = stored.provider || DEFAULT_PROVIDER;
  const settings = stored[provider] || {};
  const key = await cacheKey(provider, text, settings);
  const cached = await readCache(key);
  if (cached) return { ...cached, meta: { ...(cached.meta || {}), cache: "hit" } };
  const result = provider === "doubao" ? await synthesizeWithDoubao(text) : provider === "alibaba" ? await synthesizeWithAlibaba(text) : await synthesizeWithMiniMax(text);
  await writeCache(key, result);
  return { ...result, meta: { ...(result.meta || {}), cache: "miss" } };
}

async function synthesizeWithMiniMax(text) {
  const stored = await chrome.storage.local.get({
    minimaxApiKey: "",
    minimax: DEFAULT_MINIMAX_SETTINGS
  });
  const apiKey = String(stored.minimaxApiKey || "").trim();
  const settings = { ...DEFAULT_MINIMAX_SETTINGS, ...(stored.minimax || {}) };

  if (!apiKey) {
    throw new Error("\u8bf7\u5148\u5728\u6269\u5c55\u8bbe\u7f6e\u9875\u586b\u5199 MiniMax API Key\u3002");
  }
  if (!text || text.length >= 10000) {
    throw new Error("MiniMax sync TTS requires 1 to 9999 characters.");
  }

  const voiceSetting = {
    voice_id: settings.voiceId,
    speed: Number(settings.speed),
    vol: Number(settings.volume),
    pitch: Number(settings.pitch)
  };
  if (settings.emotion) voiceSetting.emotion = settings.emotion;

  const payload = {
    model: settings.model,
    text,
    stream: false,
    voice_setting: voiceSetting,
    audio_setting: {
      sample_rate: Number(settings.sampleRate),
      bitrate: Number(settings.bitrate),
      format: "mp3",
      channel: 1
    },
    language_boost: settings.languageBoost || "English",
    subtitle_enable: true,
    subtitle_type: "sentence",
    output_format: "hex"
  };

  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(`MiniMax returned an unparsable response: HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(result?.base_resp?.status_msg || raw || `MiniMax HTTP ${response.status}`);
  }

  const baseResp = result.base_resp || {};
  if (baseResp.status_code && baseResp.status_code !== 0) {
    throw new Error(baseResp.status_msg || `MiniMax error: ${baseResp.status_code}`);
  }

  const audioResult = resolveAudioResult(result);
  const timeline = await resolveSubtitleTimeline(result);

  return {
    ...audioResult,
    timeline,
    meta: {
      sourceKind: audioResult.audioBase64 ? "hex" : "url",
      traceId: result.trace_id,
      audioLength: result.extra_info?.audio_length,
      usageCharacters: result.extra_info?.usage_characters,
      wordCount: result.extra_info?.word_count,
      subtitleFile: result.data?.subtitle_file,
      timelineCount: timeline.length
    }
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "MINMAX_TTS_SYNTHESIZE") {
    synthesizeWithProvider(message.text)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "MINMAX_TTS_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }

  return undefined;
});
