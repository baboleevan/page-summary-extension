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
    prompt = PROMPT.format(title=msg.get("title", ""), url=msg.get("url", ""), text=msg.get("text", ""))
    cmd = [ASIDE, "exec", "--effort", EFFORT, "--timeout", TIMEOUT, prompt]
    log("run: %s (%d chars)" % (msg.get("url"), len(prompt)))
    env = make_env()
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, env=env, timeout=330)
    except FileNotFoundError:
        send_msg({"ok": False, "error": "Aside CLI를 찾지 못했습니다: " + ASIDE})
        return
    except subprocess.TimeoutExpired:
        send_msg({"ok": False, "error": "요약이 5분 안에 끝나지 않았습니다."})
        return
    sid = re.search(r"\bses_[A-Za-z0-9]+", p.stderr or "")
    answer = (p.stdout or "").strip()
    log("exit=%s sid=%s out=%d err_tail=%s" % (p.returncode, sid.group(0) if sid else None, len(answer), (p.stderr or "")[-300:].replace("\n", " | ")))
    if p.returncode != 0 or not answer:
        err = (p.stderr or "").strip().splitlines()
        send_msg({"ok": False, "error": "Aside CLI 실패 (exit %s)\n%s" % (p.returncode, "\n".join(err[-6:]))})
        return
    send_msg({"ok": True, "answer": answer, "sessionId": sid.group(0) if sid else None})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa
        log("crash: %r" % e)
        send_msg({"ok": False, "error": "연결 프로그램 오류: %r" % e})
