const HOST = "com.leevan.page_summary";
const UPDATE_ALARM = "checkUpdate";

function setup() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 360 });
}

// 툴바 버튼을 누르면 사이드패널이 열리고, 패널이 열리자마자 요약을 시작한다.
chrome.runtime.onInstalled.addListener(() => {
  setup();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "summary-page", title: "핵심 정리: 이 페이지 요약", contexts: ["page", "link", "image"] });
    chrome.contextMenus.create({ id: "summary-selection", title: "핵심 정리: 선택한 텍스트 요약", contexts: ["selection"] });
  });
});
chrome.runtime.onStartup.addListener(setup);

// 우클릭 메뉴: 제스처가 유지되도록 sidePanel.open을 await 없이 먼저 호출한다.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const mode = info.menuItemId === "summary-selection" ? "selection" : "page";
  chrome.sidePanel.open({ tabId: tab.id }).catch(console.error);
  chrome.storage.session.set({ pendingRequest: { tabId: tab.id, mode, ts: Date.now() } });
  // 이미 열린 패널이면 바로 실행 (열린 패널이 없으면 에러가 나므로 무시)
  chrome.runtime.sendMessage({ type: "summarize", mode }).catch(() => {});
});

// GitHub 최신 릴리즈 확인 → 연결 프로그램이 새 버전으로 교체하면 확장을 다시 로드한다.
function checkUpdate() {
  let port;
  try { port = chrome.runtime.connectNative(HOST); } catch (e) { return console.warn(e); }
  port.onMessage.addListener((msg) => {
    port.disconnect();
    if (msg?.updated) {
      console.log("업데이트됨:", msg.version);
      chrome.runtime.reload();
    } else if (msg && !msg.ok) {
      console.warn(msg.error);
    }
  });
  port.onDisconnect.addListener(() => void chrome.runtime.lastError);
  port.postMessage({ type: "update", current: chrome.runtime.getManifest().version });
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === UPDATE_ALARM) checkUpdate(); });
