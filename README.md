# 핵심 정리 (Aside)

툴바 버튼(또는 ⌃0)을 누르면 사이드패널이 열리고 현재 페이지 본문을 `aside exec`로 요약합니다.
페이지 우클릭 → "핵심 정리: 이 페이지 요약", 텍스트 선택 후 우클릭 → "핵심 정리: 선택한 텍스트 요약"으로도 실행할 수 있습니다.
CLI 세션 저장(save-sessions)이 켜져 있으면 요약 대화가 Aside 채팅 목록에도 남습니다. Chrome/Aside 공통.

구조: extension(sidepanel) → native messaging(com.leevan.page_summary) → host/page_summary_host.py → ~/.local/bin/aside exec

## 설치
처음 한 번만 아래 두 단계를 하면 됩니다. 이후 업데이트는 자동입니다.

1. `./install.sh` 실행
   - 레포를 클론했다면 레포 폴더에서, 아니면 Releases의 zip을 풀고 그 안에서 실행
   - 파일 복사, 연결 프로그램 등록, Aside 채팅 목록 저장 설정까지 스크립트가 모두 처리합니다. 따로 등록할 것은 없습니다.
2. `chrome://extensions` → 개발자 모드 켜기 → "압축해제된 확장 프로그램 로드" → `~/Library/Application Support/PageSummary/extension` 선택
   - 파일 선택 창에서 `⌘⇧G`를 누르고 경로를 붙여넣으면 바로 이동합니다.

필요 조건: Aside CLI(`~/.local/bin/aside`), 로그인된 `gh` CLI(`gh auth login`, 자동 업데이트용)

## 릴리즈 / 자동 업데이트
- `main`에 push(또는 PR merge)하면 GitHub Actions가 `page-summary-vX.Y.N.zip`을 Releases에 올립니다.
  버전은 manifest의 `X.Y` + 워크플로 실행 번호 `N`.
- 설치된 확장은 브라우저 시작 1분 뒤와 6시간마다 연결 프로그램을 통해 `gh`로 최신 릴리즈를 확인하고,
  새 버전이면 설치 경로의 `extension/`, `host/`를 교체한 뒤 스스로 다시 로드합니다.
- 레포 작업 트리(`.git`이 있는 경로)에서 직접 로드한 경우에는 자동 업데이트를 건너뜁니다.
- 로그: `~/Library/Logs/page-summary-host.log`

설정: 요약 프롬프트/effort는 host/page_summary_host.py 상단.
- 텍스트를 200자 넘게 선택한 상태면 선택 영역만 요약. 같은 URL은 브라우저 세션 동안 캐시(다시 요약 버튼으로 갱신).
