const M = { endpoint: "https://api.minimaxi.com/v1/t2a_v2", model: "speech-2.8-turbo", voiceId: "English_expressive_narrator", speed: 1, volume: 1, pitch: 0, emotion: "fluent", languageBoost: "English", sampleRate: 32000, bitrate: 128000 };
const D = { model: "seed-tts-2.0", voiceId: "zh_female_vv_uranus_bigtts", sampleRate: 24000 };
const A = { model: "qwen3-tts-flash", voiceId: "Cherry", languageType: "Chinese", instruction: "", rate: 1, volume: 50, pitch: 1, sampleRate: 24000, format: "mp3" };
const ids = ["provider", "api-key", "doubao-api-key", "alibaba-api-key", "endpoint", "model", "voice-preset", "custom-voice-id", "language-boost", "emotion", "speed", "volume", "pitch", "sample-rate", "doubao-model", "doubao-voice", "doubao-custom-voice", "doubao-sample-rate", "alibaba-model", "alibaba-voice", "alibaba-custom-voice", "alibaba-language", "alibaba-instruction", "alibaba-rate", "alibaba-volume", "alibaba-pitch", "alibaba-sample-rate", "auto-hide", "status"];
const f = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const voices = {
  minimax: [["English_expressive_narrator", "MiniMax - English narrator"], ["English_radiant_girl", "MiniMax - radiant girl"], ["Chinese (Mandarin)_Lyrical_Voice", "MiniMax - 中文 lyrical voice"], ["Chinese (Mandarin)_Warm_Girl", "MiniMax - 中文 warm girl"]],
  doubao: [["zh_female_vv_uranus_bigtts", "豆包 - Vivi 2.0"], ["zh_male_beijingxiaoye_moon_bigtts", "豆包 - 北京小爷"], ["zh_female_wanwanxiaohe_moon_bigtts", "豆包 - 湾湾小何"]],
  qwen: [["Cherry", "阿里 Qwen3-TTS - Cherry"], ["Serena", "阿里 Qwen3-TTS - Serena"], ["Ethan", "阿里 Qwen3-TTS - Ethan"], ["Chelsie", "阿里 Qwen3-TTS - Chelsie"]],
  cosy: [["longanhuan_v3", "阿里 CosyVoice - 龙安欢"], ["longanyang", "阿里 CosyVoice - 龙安洋"], ["loongabby_v3", "阿里 CosyVoice - Abby"], ["loongandy_v3", "阿里 CosyVoice - Andy"]]
};
const languages = {
  qwen: [["Auto", "阿里 Qwen3-TTS - Auto"], ["Chinese", "阿里 Qwen3-TTS - 中文"], ["English", "阿里 Qwen3-TTS - 英语"], ["Japanese", "阿里 Qwen3-TTS - 日语"], ["Korean", "阿里 Qwen3-TTS - 韩语"]],
  cosy: [["", "阿里 CosyVoice - 不指定"], ["zh", "阿里 CosyVoice - 中文"], ["en", "阿里 CosyVoice - 英语"], ["ja", "阿里 CosyVoice - 日语"], ["ko", "阿里 CosyVoice - 韩语"]]
};

function fill(select, values, value, custom) {
  select.replaceChildren(...values.map(([id, label]) => new Option(label, id)), new Option(custom, "custom"));
  select.value = values.some(([id]) => id === value) ? value : "custom";
}
function updateCustomRows() {
  document.getElementById("minimax-custom-row").hidden = f["voice-preset"].value !== "custom";
  document.getElementById("doubao-custom-row").hidden = f["doubao-voice"].value !== "custom";
  document.getElementById("alibaba-custom-row").hidden = f["alibaba-voice"].value !== "custom";
}
function render() {
  document.querySelectorAll("[data-provider-panel]").forEach((el) => { el.hidden = el.dataset.providerPanel !== f.provider.value; });
  const cosy = /^cosyvoice-/i.test(f["alibaba-model"].value);
  fill(f["alibaba-voice"], cosy ? voices.cosy : voices.qwen, f["alibaba-voice"].value, "自定义阿里 Voice ID");
  const previousLanguage = f["alibaba-language"].value;
  f["alibaba-language"].replaceChildren(...(cosy ? languages.cosy : languages.qwen).map(([id, label]) => new Option(label, id)));
  f["alibaba-language"].value = Array.from(f["alibaba-language"].options).some((o) => o.value === previousLanguage) ? previousLanguage : (cosy ? "" : "Chinese");
  document.getElementById("alibaba-cosy-controls").hidden = !cosy;
  document.getElementById("alibaba-instruction-row").hidden = !cosy && f["alibaba-model"].value !== "qwen3-tts-instruct-flash";
  updateCustomRows();
}
function selected(select, custom, fallback) { return select.value === "custom" ? (custom.value.trim() || fallback) : select.value; }

async function load() {
  const s = await chrome.storage.local.get({ provider: "minimax", minimaxApiKey: "", doubaoApiKey: "", alibabaApiKey: "", minimax: M, doubao: D, alibaba: A, panel: { autoHideOnDone: false } });
  const m = { ...M, ...s.minimax }, d = { ...D, ...s.doubao }, a = { ...A, ...s.alibaba };
  f.provider.value = s.provider; f["api-key"].value = s.minimaxApiKey; f["doubao-api-key"].value = s.doubaoApiKey; f["alibaba-api-key"].value = s.alibabaApiKey;
  f.endpoint.value = m.endpoint; f.model.value = m.model; fill(f["voice-preset"], voices.minimax, m.voiceId, "自定义 MiniMax Voice ID"); f["custom-voice-id"].value = m.voiceId; f["language-boost"].value = m.languageBoost; f.emotion.value = m.emotion; f.speed.value = m.speed; f.volume.value = m.volume; f.pitch.value = m.pitch; f["sample-rate"].value = m.sampleRate;
  f["doubao-model"].value = d.model; fill(f["doubao-voice"], voices.doubao, d.voiceId, "自定义豆包 Speaker ID"); f["doubao-custom-voice"].value = d.voiceId; f["doubao-sample-rate"].value = d.sampleRate;
  f["alibaba-model"].value = a.model; const storedAlibabaVoice = a.voiceId === "longanhuan_v3.6" ? "longanhuan_v3" : a.voiceId; const cosy = /^cosyvoice-/i.test(a.model); fill(f["alibaba-voice"], cosy ? voices.cosy : voices.qwen, cosy && (storedAlibabaVoice === "Cherry" || !storedAlibabaVoice) ? "longanhuan_v3" : (storedAlibabaVoice || "Cherry"), "自定义阿里 Voice ID"); f["alibaba-custom-voice"].value = storedAlibabaVoice || ""; f["alibaba-language"].replaceChildren(...(cosy ? languages.cosy : languages.qwen).map(([id, label]) => new Option(label, id))); f["alibaba-language"].value = cosy ? (a.languageHint || "") : (a.languageType || "Chinese"); f["alibaba-instruction"].value = a.instruction; f["alibaba-rate"].value = a.rate; f["alibaba-volume"].value = a.volume; f["alibaba-pitch"].value = a.pitch; f["alibaba-sample-rate"].value = a.sampleRate; f["auto-hide"].checked = Boolean(s.panel.autoHideOnDone);
  render();
}

async function save() {
  const cosy = /^cosyvoice-/i.test(f["alibaba-model"].value);
  const minimax = { endpoint: f.endpoint.value, model: f.model.value, voiceId: selected(f["voice-preset"], f["custom-voice-id"], M.voiceId), speed: Number(f.speed.value), volume: Number(f.volume.value), pitch: Number(f.pitch.value), emotion: f.emotion.value, languageBoost: f["language-boost"].value, sampleRate: Number(f["sample-rate"].value), bitrate: M.bitrate };
  const doubao = { model: f["doubao-model"].value, voiceId: selected(f["doubao-voice"], f["doubao-custom-voice"], D.voiceId), sampleRate: Number(f["doubao-sample-rate"].value) };
  const alibaba = { model: f["alibaba-model"].value, voiceId: selected(f["alibaba-voice"], f["alibaba-custom-voice"], cosy ? "longanhuan_v3" : "Cherry"), languageType: cosy ? "" : f["alibaba-language"].value, languageHint: cosy ? f["alibaba-language"].value : "", instruction: f["alibaba-instruction"].value.trim(), rate: Number(f["alibaba-rate"].value || 1), volume: Number(f["alibaba-volume"].value || 50), pitch: Number(f["alibaba-pitch"].value || 1), sampleRate: Number(f["alibaba-sample-rate"].value || 24000), format: "mp3" };
  await chrome.storage.local.set({ provider: f.provider.value, minimaxApiKey: f["api-key"].value.trim(), doubaoApiKey: f["doubao-api-key"].value.trim(), alibabaApiKey: f["alibaba-api-key"].value.trim(), minimax, doubao, alibaba, panel: { autoHideOnDone: f["auto-hide"].checked } });
  f.status.textContent = "已保存";
}
function responseAudio(r) { const a = new Audio(); const binary = atob(r.audioBase64 || ""); a.src = URL.createObjectURL(new Blob([Uint8Array.from(binary, (c) => c.charCodeAt(0))], { type: r.audioMime || "audio/mpeg" })); return a; }

f.provider.addEventListener("change", render);
f["alibaba-model"].addEventListener("change", render);
["voice-preset", "doubao-voice", "alibaba-voice"].forEach((id) => f[id].addEventListener("change", updateCustomRows));
document.getElementById("settings-form").addEventListener("submit", async (event) => { event.preventDefault(); await save(); });
document.getElementById("test").addEventListener("click", async () => { await save(); f.status.textContent = "正在生成测试音频..."; const r = await chrome.runtime.sendMessage({ type: "MINMAX_TTS_SYNTHESIZE", text: f.provider.value === "minimax" ? "Practice makes progress." : "你好，这是 AliceReader 的测试朗读。" }); if (!r?.ok) { f.status.textContent = r?.error || "测试失败"; return; } try { await responseAudio(r).play(); f.status.textContent = `测试音频播放中 · ${r.meta?.model || f.provider.value}`; } catch (error) { f.status.textContent = error.message || "播放失败"; } });
load();
