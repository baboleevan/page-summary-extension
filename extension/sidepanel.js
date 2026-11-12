const HOST = "com.leevan.page_summary";
const $ = (id) => document.getElementById(id);
let running = false;
let lastAnswer = "";
let currentTab = null;
// 화면에 보이는 요약 { data, cacheKey }. 추가 질문은 활성 탭이 아니라 이 요약의 Aside 세션으로 보낸다.
let current = null;

// 페이지 안에서 실행되는 본문 추출 함수 (직렬화되어 주입됨)
function extractMainText(mode) {
  const sel = ["article", "[role=main]", "main", ".entry-content", ".tt_article_useless_p_margin",
    ".post-content", ".article-body", "#content", ".content"];
  let best = null, bestLen = 0;
  for (const s of sel) {
    for (const el of document.querySelectorAll(s)) {
      const len = (el.innerText || "").trim().length;
      if (len > bestLen) { best = el; bestLen = len; }
    }
  }
  const sel2 = window.getSelection && String(window.getSelection()).trim();
  // 우클릭 "선택한 텍스트 요약"이면 길이와 상관없이 선택 영역 사용
  const useSel = !!sel2 && (mode === "selection" || (mode !== "page" && sel2.length > 200));
  let text = useSel ? sel2 : (bestLen > 500 ? best.innerText : document.body.innerText);
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return { title: document.title, url: location.href, text: text.slice(0, 40000), truncated: text.length > 40000, fromSelection: useSel };
}

function setStatus(html, isError = false) {
  const el = $("status");
  el.className = "status" + (isError ? " error" : "");
  el.innerHTML = html;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function askHost(payload) {
  return new Promise((resolve, reject) => {
    let port;
    try { port = chrome.runtime.connectNative(HOST); } catch (e) { return reject(e); }
    let done = false;
    port.onMessage.addListener((msg) => { done = true; resolve(msg); port.disconnect(); });
    port.onDisconnect.addListener(() => {
      if (!done) reject(new Error(chrome.runtime.lastError?.message || "연결 프로그램이 응답 없이 종료됐습니다."));
    });
    port.postMessage(payload);
  });
}

// 요약/질문/업데이트 중에는 다른 작업 버튼을 막는다 (입력창은 다음 질문을 미리 쓸 수 있게 열어 둔다).
function setBusy(on) {
  running = on;
  $("runBtn").disabled = on;
  $("updateBtn").disabled = on;
  renderComposer();
}

function renderComposer() {
  const canAsk = !!current?.data?.sessionId;
  $("askForm").hidden = !current;
  $("askInput").disabled = !canAsk;
  $("askBtn").disabled = !canAsk || running;
  $("askInput").placeholder = canAsk ? "이 페이지에 대해 더 물어보기" : "다시 요약하면 질문할 수 있어요";
  $("askInput").title = canAsk
    ? "Enter 전송 · Shift+Enter 줄바꿈"
    : "이 요약에는 이어서 질문할 Aside 세션 정보가 없습니다. '이 페이지 요약'을 다시 눌러주세요.";
}

function showResult(data, cacheKey = null) {
  current = { data, cacheKey };
  lastAnswer = data.answer || "";
  $("result").innerHTML = renderMarkdown(lastAnswer);
  $("copyBtn").disabled = !lastAnswer;
  const bits = [];
  if (data.elapsed) bits.push(`${data.elapsed}초`);
  if (data.sessionId) bits.push(`Aside 채팅에 저장됨 (${data.sessionId})`);
  if (data.truncated) bits.push("본문이 길어 앞 40,000자만 사용");
  if (data.fromSelection) bits.push("선택한 텍스트 기준");
  $("meta").textContent = bits.join(" · ");
  $("thread").innerHTML = "";
  for (const item of data.chat || []) {
    addMsg("q", item.q);
    fillAnswer(addMsg("a"), item);
  }
  renderComposer();
}

function clearResult() {
  current = null;
  lastAnswer = "";
  $("result").innerHTML = ""; $("meta").textContent = ""; $("thread").innerHTML = "";
  $("copyBtn").disabled = true;
  renderComposer();
}

async function summarize(force = false, mode = "auto") {
  if (running) return;
  currentTab = await getActiveTab();
  if (!currentTab?.id || !/^https?:/.test(currentTab.url || "")) {
    setStatus("일반 웹페이지(http/https)에서만 요약할 수 있습니다.", true);
    return;
  }
  $("pageTitle").textContent = currentTab.title || currentTab.url;

  const cacheKey = "sum:" + currentTab.url;
  if (mode === "selection") force = true; // 선택 영역 요약은 캐시하지 않음
  if (!force) {
    const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
    if (cached) { setStatus("이전에 만든 요약입니다. 새로 만들려면 버튼을 누르세요."); showResult(cached, cacheKey); return; }
  }

  chrome.storage.session.set({ busyUntil: Date.now() + 6 * 60 * 1000 }); // 요약 중 자동 업데이트 재로드 방지
  clearResult(); // 새 요약은 새 Aside 세션이라 이전 대화도 지운다
  setBusy(true);
  const started = Date.now();
  const tick = () => setStatus(`<span class="spinner"></span>Aside로 요약 중... ${Math.round((Date.now() - started) / 1000)}초`);
  tick();
  const timer = setInterval(tick, 1000);
  try {
    const [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, func: extractMainText, args: [mode] });
    if (!page?.text || page.text.length < 50) throw new Error("본문 텍스트를 찾지 못했습니다.");
    const res = await askHost({ title: page.title, url: page.url, text: page.text });
    if (!res?.ok) throw new Error(res?.error || "요약에 실패했습니다.");
    const data = { ...res, elapsed: Math.round((Date.now() - started) / 1000), truncated: page.truncated, fromSelection: page.fromSelection, chat: [] };
    if (mode !== "selection") await chrome.storage.session.set({ [cacheKey]: data });
    setStatus("");
    showResult(data, mode !== "selection" ? cacheKey : null);
  } catch (e) {
    let msg = e.message || String(e);
    if (/native messaging host not found|Specified native messaging host not found/i.test(msg)) {
      msg += "\n\ninstall.sh 를 실행해 연결 프로그램을 등록했는지 확인하세요.";
    }
    setStatus(msg, true);
  } finally {
    clearInterval(timer);
    chrome.storage.session.remove("busyUntil");
    setBusy(false);
  }
}

// ---- 추가 질문: 요약을 만든 Aside 세션을 이어서(session resume) 묻는다 ----
function addMsg(kind, text) {
  const el = document.createElement("div");
  el.className = "msg " + kind;
  if (text != null) el.textContent = text;
  $("thread").appendChild(el);
  return el;
}

function fillAnswer(el, item) {
  el.className = "msg a md";
  el.innerHTML = renderMarkdown(item.a || "");
  if (item.elapsed) {
    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = `${item.elapsed}초`;
    el.appendChild(meta);
  }
}

// 고정 헤더에 가리지 않게 el이 헤더 바로 아래 오도록 스크롤
function scrollToMsg(el) {
  const top = el.getBoundingClientRect().top + window.scrollY - document.querySelector("header").offsetHeight - 8;
  window.scrollTo({ top, behavior: "smooth" });
}

function autoGrow() {
  const t = $("askInput");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight + t.offsetHeight - t.clientHeight, 140) + "px";
}

async function ask(question) {
  const target = current;
  if (running || !target?.data?.sessionId || !question) return;
  chrome.storage.session.set({ busyUntil: Date.now() + 6 * 60 * 1000 }); // 답변 중 자동 업데이트 재로드 방지
  setBusy(true);
  setStatus("");
  const qEl = addMsg("q", question);
  const aEl = addMsg("pending");
  const started = Date.now();
  const tick = () => { aEl.innerHTML = `<span class="spinner"></span>Aside가 답변 중... ${Math.round((Date.now() - started) / 1000)}초`; };
  tick();
  const timer = setInterval(tick, 1000);
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  try {
    const res = await askHost({ type: "ask", sessionId: target.data.sessionId, question });
    if (!res?.ok) throw new Error(res?.error || "답변을 받지 못했습니다.");
    const item = { q: question, a: res.answer, elapsed: Math.round((Date.now() - started) / 1000) };
    target.data.chat = [...(target.data.chat || []), item];
    if (target.cacheKey) await chrome.storage.session.set({ [target.cacheKey]: target.data });
    fillAnswer(aEl, item);
    scrollToMsg(qEl);
  } catch (e) {
    aEl.className = "msg error";
    aEl.textContent = e.message || String(e);
    // 실패한 질문은 입력창에 되돌려 다시 보낼 수 있게 한다 (그사이 새로 쓴 내용이 있으면 그대로 둔다)
    if (!$("askInput").value.trim()) { $("askInput").value = question; autoGrow(); }
  } finally {
    clearInterval(timer);
    chrome.storage.session.remove("busyUntil");
    setBusy(false);
  }
}

$("askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("askInput").value.trim();
  if (!q || running || !current?.data?.sessionId) return;
  $("askInput").value = "";
  autoGrow();
  ask(q);
});
$("askInput").addEventListener("input", autoGrow);
$("askInput").addEventListener("keydown", (e) => {
  // 한글 조합 중 Enter는 글자 확정용이므로 전송하지 않는다
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("askForm").requestSubmit();
  }
});

$("runBtn").addEventListener("click", () => summarize(true));
$("copyBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(lastAnswer);
  $("copyBtn").textContent = "복사됨"; setTimeout(() => ($("copyBtn").textContent = "복사"), 1200);
});
// 플러그인 업데이트: 연결 프로그램이 최신 릴리즈를 받아 교체하면 확장을 다시 로드한다.
const currentVersion = chrome.runtime.getManifest().version;
$("updateBtn").title = `현재 버전 v${currentVersion}`;
$("versionLabel").textContent = `v${currentVersion}`;
$("versionLabel").title = `현재 설치된 버전 v${currentVersion}`;

const isNewer = (a, b) => {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
};

// 구버전이면 업데이트 버튼 위에 새 버전 배지 표시
function renderBadge(latest) {
  const badge = $("updateBadge");
  const show = latest && isNewer(latest, currentVersion);
  badge.hidden = !show;
  badge.textContent = show ? `v${latest}` : "";
  $("updateBtn").title = show ? `새 버전 v${latest} (현재 v${currentVersion})` : `현재 버전 v${currentVersion}`;
}

(async () => {
  const { latestVersion, latestCheckedAt } = await chrome.storage.local.get(["latestVersion", "latestCheckedAt"]);
  renderBadge(latestVersion);
  // 패널을 열 때 10분 넘게 확인하지 않았으면 다시 확인 (설치는 하지 않음)
  if (!latestCheckedAt || Date.now() - latestCheckedAt > 10 * 60 * 1000) {
    try {
      const res = await askHost({ type: "check" });
      if (res?.ok) chrome.storage.local.set({ latestVersion: res.latest, latestCheckedAt: Date.now() });
    } catch (e) { console.warn(e); }
  }
})();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.latestVersion) renderBadge(changes.latestVersion.newValue);
});
$("updateBtn").addEventListener("click", async () => {
  if (running) return;
  setBusy(true);
  setStatus(`<span class="spinner"></span>업데이트 확인 중... (현재 v${currentVersion})`);
  try {
    const res = await askHost({ type: "update", current: currentVersion });
    if (!res?.ok) throw new Error(res?.error || "업데이트 확인에 실패했습니다.");
    if (res.updated) {
      setStatus(`v${res.version}로 업데이트했습니다. 확장을 다시 로드합니다 (패널이 닫히면 다시 열어주세요).`);
      setTimeout(() => chrome.runtime.reload(), 1500);
      return;
    }
    if (res.latest) chrome.storage.local.set({ latestVersion: res.latest, latestCheckedAt: Date.now() });
    if (res.skipped) setStatus(`업데이트하지 않음: ${res.skipped}`);
    else setStatus(`이미 최신 버전입니다 (v${currentVersion}).`);
  } catch (e) {
    setStatus(e.message || String(e), true);
  }
  setBusy(false);
});

// 다른 탭으로 옮기면 제목만 갱신 (자동 재요약은 하지 않음)
chrome.tabs.onActivated.addListener(async () => {
  if (running) return;
  const t = await getActiveTab();
  $("pageTitle").textContent = t?.title || t?.url || "-";
});

// 우클릭 메뉴(패널이 이미 열린 경우)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "summarize") {
    chrome.storage.session.remove("pendingRequest");
    summarize(msg.mode === "selection", msg.mode);
  }
});

// 패널이 열리면 바로 요약 시작 (우클릭으로 열렸으면 그 요청 모드로)
(async () => {
  const { pendingRequest: p } = await chrome.storage.session.get("pendingRequest");
  if (p && Date.now() - p.ts < 5000) {
    await chrome.storage.session.remove("pendingRequest");
    summarize(p.mode === "selection", p.mode);
  } else {
    summarize(false);
  }
})();
