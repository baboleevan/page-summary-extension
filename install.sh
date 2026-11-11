#!/bin/bash
# 확장/연결 프로그램을 설치 경로로 복사하고, native messaging host를 Aside와 Chrome에 등록한다.
# 설치 경로는 git 작업 트리와 분리되어 있어 자동 업데이트가 이곳만 교체한다.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_ID="$(cat "$DIR/.keys/id.txt")"
HOST_NAME="com.leevan.page_summary"
INSTALL_DIR="${PAGE_SUMMARY_HOME:-$HOME/Library/Application Support/PageSummary}"

mkdir -p "$INSTALL_DIR"
for D in extension host; do
  rsync -a --delete --exclude '__pycache__' --exclude '.DS_Store' "$DIR/$D/" "$INSTALL_DIR/$D/"
done
HOST_PATH="$INSTALL_DIR/host/page_summary_host.py"
chmod +x "$HOST_PATH"
echo "설치: $INSTALL_DIR"

MANIFEST=$(cat <<JSON
{
  "name": "$HOST_NAME",
  "description": "Page summary via Aside CLI",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON
)
for B in "Aside" "Google/Chrome"; do
  T="$HOME/Library/Application Support/$B/NativeMessagingHosts"
  mkdir -p "$T"
  echo "$MANIFEST" > "$T/$HOST_NAME.json"
  echo "등록: $T/$HOST_NAME.json"
done
"$HOME/.local/bin/aside" settings save-sessions enable && echo "Aside 채팅 목록 저장: 켜짐" || echo "save-sessions 설정 실패: 터미널에서 'aside settings save-sessions enable' 실행"
command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && echo "자동 업데이트: gh 인증 확인됨" || echo "자동 업데이트에는 gh CLI 로그인이 필요합니다: gh auth login"
echo "확장 ID: $EXT_ID"
echo "chrome://extensions 에서 개발자 모드 > '압축해제된 확장 프로그램 로드' > $INSTALL_DIR/extension"
echo "(이미 로드돼 있었다면 기존 항목을 제거하고 위 경로로 다시 로드하세요)"
