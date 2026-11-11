const HOST = "com.leevan.page_summary";
const CHECK_ALARM = "checkLatest"; // 6시간마다 새 버전 확인만 (설치 X)
const RELOAD_ALARM = "reloadPending";

// 요약 중(sidepanel이 busyUntil 기록)이면 재로드를 30초씩 미룬다. 재로드하면 패널과 진행 중인 요약이 끊기기 때문.
async function reloadWhenIdle() {
  const { busyUntil } = await chrome.storage.session.get("busyUntil");
  if (busyUntil && busyUntil > Date.now()) {
    chrome.alarms.create(RELOAD_ALARM, { delayInMinutes: 0.5 });
  } else {
    chrome.runtime.reload();
  }
}

function setup() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  chrome.alarms.clear("checkUpdate"); // 예전 버전의 자동 업데이트 알람 제거
  chrome.alarms.create(CHECK_ALARM, { delayInMinutes: 1, periodInMinutes: 360 });
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

// 연결 프로그램에 한 번 요청하고 응답을 받는다.
function askHost(payload) {
  return new Promise((resolve, reject) => {
    let port;
    try { port = chrome.runtime.connectNative(HOST); } catch (e) { return reject(e); }
    let done = false;
    port.onMessage.addListener((msg) => { done = true; resolve(msg); port.disconnect(); });
    port.onDisconnect.addListener(() => { if (!done) reject(new Error(chrome.runtime.lastError?.message || "연결 프로그램 종료")); });
    port.postMessage(payload);
  });
}

// 최신 버전을 저장해 두면 사이드패널이 "플러그인 업데이트" 버튼에 배지로 표시한다.
function saveLatest(latest) {
  if (latest) chrome.storage.local.set({ latestVersion: latest, latestCheckedAt: Date.now() });
}

// 브라우저 시작 시에만 자동 업데이트: 새 버전이면 연결 프로그램이 교체하고 확장을 다시 로드한다.
async function autoUpdate() {
  try {
    const res = await askHost({ type: "update", current: chrome.runtime.getManifest().version });
    if (res?.updated) { console.log("업데이트됨:", res.version); reloadWhenIdle(); }
    else if (res?.ok) saveLatest(res.latest);
    else console.warn(res?.error);
  } catch (e) { console.warn(e); }
}

// 그 외에는 확인만 (설치는 버튼으로 수동)
async function checkLatest() {
  try {
    const res = await askHost({ type: "check" });
    if (res?.ok) saveLatest(res.latest); else console.warn(res?.error);
  } catch (e) { console.warn(e); }
}

chrome.runtime.onStartup.addListener(autoUpdate);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === CHECK_ALARM) checkLatest();
  if (a.name === RELOAD_ALARM) reloadWhenIdle();
});
