#!/usr/bin/python3
"""Native messaging host: 확장에서 받은 본문을 `aside exec`로 요약해 돌려준다."""
import fcntl, json, os, re, shutil, struct, subprocess, sys, tempfile, time, urllib.request, zipfile

ASIDE = os.path.expanduser("~/.local/bin/aside")
EFFORT = os.environ.get("PAGE_SUMMARY_EFFORT", "low")
TIMEOUT = "5m"
LOG = os.path.expanduser("~/Library/Logs/page-summary-host.log")
REPO = "baboleevan/page-summary-extension"
INSTALL_DIR = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
EXTRA_PATH = os.path.expanduser("~/.local/bin") + ":/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

PROMPT = """[핵심 정리] {title}

아래는 웹페이지 본문이야. 브라우저를 열거나 조작하지 말고, 주어진 본문만으로 한국어 핵심 정리를 해줘.

형식:
- 맨 위에 **한 줄 요약**
- 본문의 섹션(소제목) 흐름을 따라 섹션별로 2~5개 bullet
- 마지막에 "시사점"이 있으면 1~3줄
- 마크다운만 출력하고 서론/맺음말은 쓰지 마.

URL: {url}

----- 본문 시작 -----
{text}
----- 본문 끝 -----"""

# 요약 세션을 이어서(session resume) 묻는다. 고정 접두어가 있어 질문이 "-"로 시작해도 CLI 옵션으로 해석되지 않는다.
ASK_PROMPT = """[추가 질문] 브라우저를 열거나 조작하지 말고, 앞에서 준 본문과 지금까지의 대화를 바탕으로 한국어로 답해줘.
본문에 없는 내용이면 그렇다고 밝히고, 일반 지식으로 보충할 때는 본문 내용과 구분해서 말해줘.
마크다운만 출력하고 서론/맺음말은 쓰지 마.

질문: {question}"""


def log(msg):
    try:
        with open(LOG, "a") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    except Exception:
        pass


def read_msg():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    n = struct.unpack("<I", raw)[0]
    return json.loads(sys.stdin.buffer.read(n).decode("utf-8"))


def send_msg(obj):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()


def make_env():
    env = dict(os.environ)
    env["PATH"] = EXTRA_PATH + ":" + env.get("PATH", "")
    return env


def parse_ver(v):
    try:
        return tuple(int(x) for x in str(v).lstrip("v").split("."))
    except ValueError:
        return (0,)


def http_get(url, timeout=60):
    """public 레포라 인증 없이 GitHub API/릴리즈 파일을 받는다."""
    req = urllib.request.Request(url, headers={"User-Agent": "page-summary-updater", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def update(current):
    """최신 릴리즈가 current보다 새로우면 zip을 받아 설치 경로의 extension/, host/를 교체한다."""
    if os.path.exists(os.path.join(INSTALL_DIR, ".git")):
        return {"ok": True, "updated": False, "skipped": "git 작업 트리에서 실행 중이라 자동 업데이트를 건너뜀"}
    rel = json.loads(http_get("https://api.github.com/repos/%s/releases/latest" % REPO))
    tag = rel["tag_name"]
    if parse_ver(tag) <= parse_ver(current):
        return {"ok": True, "updated": False, "latest": tag.lstrip("v")}
    lock = open(os.path.join(INSTALL_DIR, ".update.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return {"ok": True, "updated": False, "skipped": "다른 업데이트가 진행 중"}
    try:
        with tempfile.TemporaryDirectory(prefix="page-summary-") as tmp:
            asset = next((a for a in rel.get("assets", []) if a["name"].endswith(".zip")), None)
            if not asset:
                raise RuntimeError("릴리즈 %s에 zip이 없습니다" % tag)
            zpath = os.path.join(tmp, asset["name"])
            with open(zpath, "wb") as f:
                f.write(http_get(asset["browser_download_url"], timeout=300))
            out = os.path.join(tmp, "x")
            with zipfile.ZipFile(zpath) as z:
                z.extractall(out)
            root = os.path.join(out, "page-summary")
            if not os.path.exists(os.path.join(root, "extension", "manifest.json")):
                raise RuntimeError("zip 구조가 올바르지 않습니다")
            for d in ("extension", "host"):
                dst = os.path.join(INSTALL_DIR, d)
                new, old = dst + ".new", dst + ".old"
                shutil.rmtree(new, ignore_errors=True)
                shutil.rmtree(old, ignore_errors=True)
                shutil.copytree(os.path.join(root, d), new)
                if os.path.exists(dst):
                    os.replace(dst, old)
                os.replace(new, dst)
                shutil.rmtree(old, ignore_errors=True)
            os.chmod(os.path.join(INSTALL_DIR, "host", "page_summary_host.py"), 0o755)
        log("updated %s -> %s" % (current, tag))
        return {"ok": True, "updated": True, "version": tag.lstrip("v")}
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def run_aside(args, label):
    """aside를 --json으로 실행해 {"ok", "answer", "sessionId"} 또는 {"ok": False, "error"}를 돌려준다."""
    cmd = [ASIDE] + args
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, env=make_env(), timeout=330)
    except FileNotFoundError:
        return {"ok": False, "error": "Aside CLI를 찾지 못했습니다: " + ASIDE}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "%s 5분 안에 끝나지 않았습니다." % label}
    out, err_text = (p.stdout or "").strip(), (p.stderr or "").strip()
    # --json이면 실패(타임아웃·세션 없음 등)도 stdout에 JSON으로 온다. JSON이 아니면 예전 방식(stdout=답, stderr=세션 id)으로 읽는다.
    try:
        res = json.loads(out)
        answer = (res.get("answer") or "").strip()
        sid = (res.get("session") or {}).get("id")
        error = res.get("error") or ""
    except (ValueError, AttributeError):
        m = re.search(r"session: ([A-Za-z0-9_-]+)", err_text)
        answer, sid, error = out, m.group(1) if m else None, ""
    log("exit=%s sid=%s out=%d error=%s err_tail=%s" % (p.returncode, sid, len(answer), error[:200], err_text[-300:].replace("\n", " | ")))
    if p.returncode != 0 or not answer:
        detail = "\n".join(x for x in [error] + err_text.splitlines()[-6:] if x)
        hint = ""
        if "Authentication failed" in error + err_text:
            hint = "\n\n→ Aside 앱의 모델 provider 인증이 만료됐습니다. Aside 설정에서 해당 provider(예: Claude Code)를 다시 연결하세요."
        return {"ok": False, "error": "Aside CLI 실패 (exit %s)\n%s%s" % (p.returncode, detail, hint)}
    return {"ok": True, "answer": answer, "sessionId": sid}


def main():
    msg = read_msg()
    if not msg:
        return
    if msg.get("type") == "check":  # 설치 없이 최신 버전만 확인
        try:
            rel = json.loads(http_get("https://api.github.com/repos/%s/releases/latest" % REPO))
            send_msg({"ok": True, "latest": rel["tag_name"].lstrip("v")})
        except Exception as e:  # noqa
            log("check failed: %r" % e)
            send_msg({"ok": False, "error": "버전 확인 실패: %s" % e})
        return
    if msg.get("type") == "update":
        try:
            send_msg(update(msg.get("current", "0")))
        except Exception as e:  # noqa
            log("update failed: %r" % e)
            send_msg({"ok": False, "error": "업데이트 실패: %s" % e})
        return
    if msg.get("type") == "ask":  # 요약 세션에 이어서 추가 질문
        sid, question = str(msg.get("sessionId") or ""), str(msg.get("question") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", sid):  # "-"로 시작하면 CLI 옵션으로 해석되므로 막는다
            send_msg({"ok": False, "error": "이어서 질문할 요약 세션이 없습니다. 다시 요약한 뒤 질문해주세요."})
            return
        if not question:
            send_msg({"ok": False, "error": "질문이 비어 있습니다."})
            return
        log("ask: %s (%d chars)" % (sid, len(question)))
        send_msg(run_aside(["session", "resume", "--json", "--timeout", TIMEOUT, sid, ASK_PROMPT.format(question=question)], "답변이"))
        return
    if msg.get("type") not in (None, "summarize"):
        send_msg({"ok": False, "error": "알 수 없는 요청 종류: %s (확장과 연결 프로그램 버전이 맞지 않을 수 있습니다)" % msg.get("type")})
        return
    prompt = PROMPT.format(title=msg.get("title", ""), url=msg.get("url", ""), text=msg.get("text", ""))
    log("run: %s (%d chars)" % (msg.get("url"), len(prompt)))
    send_msg(run_aside(["exec", "--json", "--effort", EFFORT, "--timeout", TIMEOUT, prompt], "요약이"))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa
        log("crash: %r" % e)
        send_msg({"ok": False, "error": "연결 프로그램 오류: %r" % e})
