# 핵심 정리 (Aside)

툴바 버튼(또는 ⌃0)을 누르면 사이드패널이 열리고 현재 페이지 본문을 `aside exec`로 요약합니다.
페이지 우클릭 → "핵심 정리: 이 페이지 요약", 텍스트 선택 후 우클릭 → "핵심 정리: 선택한 텍스트 요약"으로도 실행할 수 있습니다.
CLI 세션 저장(save-sessions)이 켜져 있으면 요약 대화가 Aside 채팅 목록에도 남습니다. Chrome/Aside 공통.

구조: extension(sidepanel) → native messaging(com.leevan.page_summary) → host/page_summary_host.py → ~/.local/bin/aside exec

## 설치
1. `gh auth login` (private 레포 릴리즈를 받기 위해 필요)
2. `./install.sh` — `~/Library/Application Support/PageSummary/`에 복사하고 Aside, Chrome NativeMessagingHosts 등록
3. 터미널: `aside settings save-sessions enable`
4. chrome://extensions → 개발자 모드 → 압축해제된 확장 프로그램 로드 → `~/Library/Application Support/PageSummary/extension`
   (manifest의 key 덕분에 ID는 항상 lbkfjnclldnifckhicfadolnajjdhlhk)

## 릴리즈 / 자동 업데이트
- `main`에 push(또는 PR merge)하면 GitHub Actions가 `page-summary-vX.Y.N.zip`을 Releases에 올립니다.
  버전은 manifest의 `X.Y` + 워크플로 실행 번호 `N`.
- 설치된 확장은 브라우저 시작 1분 뒤와 6시간마다 연결 프로그램을 통해 `gh`로 최신 릴리즈를 확인하고,
  새 버전이면 설치 경로의 `extension/`, `host/`를 교체한 뒤 스스로 다시 로드합니다.
- 레포 작업 트리(`.git`이 있는 경로)에서 직접 로드한 경우에는 자동 업데이트를 건너뜁니다.
- 로그: `~/Library/Logs/page-summary-host.log`

설정: 요약 프롬프트/effort는 host/page_summary_host.py 상단.
- 텍스트를 200자 넘게 선택한 상태면 선택 영역만 요약. 같은 URL은 브라우저 세션 동안 캐시(다시 요약 버튼으로 갱신).
