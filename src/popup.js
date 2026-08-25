const status = document.getElementById("status");
const readButton = document.getElementById("read");
const optionsButton = document.getElementById("options");

function setStatus(text) {
  status.textContent = text;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

readButton.addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.id) {
    setStatus("No active tab.");
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "MINMAX_TTS_READ_SELECTION" });
    setStatus("已发送朗读请求。");
  } catch {
    setStatus("请刷新普通网页后再试。");
  }
});

optionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
