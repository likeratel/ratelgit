# ratelgit

[English](README.md) · 한국어

[![Verify desktop builds](https://github.com/likeratel/ratelgit/actions/workflows/verify.yml/badge.svg)](https://github.com/likeratel/ratelgit/actions/workflows/verify.yml)

<img src="docs/ratelgit.png" alt="벌꿀오소리의 투톤 무늬 위에 커밋 그래프를 얹은 ratelgit 아이콘" width="128" />

ratelgit은 worktree를 중심에 둔 macOS·Windows용 Git 클라이언트입니다. 사이드바에 저장소를 추가하고 그 아래 worktree를 고르면 커밋 그래프, 변경 파일, diff가 함께 바뀌어서, 여러 프로젝트와 작업 폴더를 오가도 흐름이 끊기지 않습니다. 이름은 벌에 몇 번 쏘여도 물러서지 않는 벌꿀오소리(ratel)에서 따왔습니다. Tauri 2, React, TypeScript, Rust로 만들었고, 이미 설치된 Git 명령줄을 사용합니다.

> AI와 함께 만들었습니다. 방향은 제가 정했고, 코드·테스트·문서는 [Codex](https://openai.com/codex/)와 [Claude Code](https://claude.com/claude-code)와의 세션에서 작성했습니다. [왜 만들었나](#왜-만들었나)를 참고하세요.

> **검증 상태.** macOS(Apple Silicon)에서 개발했습니다. Git 코어는 임시 저장소를 쓰는 통합 테스트로, UI는 단위 테스트와 브라우저 테스트로 확인합니다. Windows에서는 빌드와 테스트가 CI에서 통과하지만 앱을 실행해 보지는 못했습니다. [제한 사항](#제한-사항)을 참고하세요.

![worktree의 이력: 위에는 커밋 그래프, 아래에는 선택한 커밋의 메시지·파일·diff](docs/screenshots/history.png)

스크린샷은 가상의 예제 데이터입니다.

## 한눈에 보기

- **프로젝트, 그 아래 worktree.** 추가한 저장소가 worktree와 함께 사이드바에 놓이고, worktree마다 브랜치·변경 파일 수·upstream과의 차이가 보입니다. `⌘P`로 어디로든 바로 이동합니다.
- **History가 먼저.** 그래프는 보통 필요한 것, 곧 현재 브랜치와 `origin/main`(또는 `origin/master`)부터 보여 주고, 선택한 커밋의 상세가 그 아래에 나옵니다. **Show All**로 모든 브랜치를 보고, Fork처럼 고른 브랜치들만 남기도록 필터링하며, **Default**로 돌아옵니다.
- **원하는 만큼만 스테이징.** 파일 전체, hunk, 줄 단위로 고르고 diff에서는 달라진 단어만 강조됩니다.
- **충돌도 앱 안에서.** 배너가 merge·rebase 진행 상황을 알려 주고, 충돌 구간마다 양쪽 내용을 브랜치 이름으로 보여 주어 한쪽·다른 쪽·둘 다를 고를 수 있습니다.
- **내 Git, 내 자격 증명.** 컴퓨터에 이미 설치된 Git을 실행하며 비밀번호나 토큰을 저장하지 않습니다.

## 목차

- [한눈에 보기](#한눈에-보기)
- [왜 만들었나](#왜-만들었나)
- [설치](#설치)
- [빠른 시작](#빠른-시작)
- [기능](#기능)
- [단축키](#단축키)
- [제한 사항](#제한-사항)
- [신뢰 모델](#신뢰-모델)
- [개발](#개발)
- [라이선스](#라이선스)

## 왜 만들었나

같은 저장소의 worktree를 여러 개 열어 두고 일하는데, Git 클라이언트에 바라는 것은 단순했습니다. worktree를 고르면 그 그래프와 diff가 보이는 것입니다. Sourcetree, Fork, GitKraken은 일상적인 Git 기능을 잘 다루지만 worktree 사이를 오가는 일이 중심은 아닙니다. ratelgit은 그 기본기(브랜치, 커밋 그래프, 스테이징, diff 뷰어, fetch·pull·push)를 가져오고 worktree 목록을 맨 앞에 두었습니다.

제가 한 일: 조회 전용 브라우저에서 시작해 스테이징·커밋·원격 작업·충돌 해결을 더하는 순서로 범위를 정했고, 안전 규칙(pull은 fast-forward만, push는 설정된 upstream으로의 일반 push, 되돌릴 수 없는 동작은 항상 확인)을 골랐습니다. 첫 버전은 macOS용 SwiftUI 앱이었고, 이번 버전은 다른 ratel 앱들처럼 같은 코드로 Windows에서도 돌도록 Tauri로 옮겼습니다. SwiftUI 버전은 [`swiftui` 브랜치](https://github.com/likeratel/ratelgit/tree/swiftui)에 남겨 두었습니다. 프로젝트 목록은 넘어오지 않으니 저장소를 다시 추가해 주세요.

## 설치

ratelgit을 쓰려면 [Git](https://git-scm.com/downloads) 2.36 이상이 설치되어 있어야 합니다. [Releases 페이지](https://github.com/likeratel/ratelgit/releases/latest)에서 최신 빌드를 내려받으세요.

| 플랫폼                             | 파일                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------- |
| macOS 12 이상, Apple Silicon·Intel | `RatelGit_<version>_universal.dmg`                                         |
| Windows 10 이상, x64               | `ratelgit_<version>_x64-setup.exe` 또는 `ratelgit_<version>_x64_en-US.msi` |

- **macOS.** DMG를 열고 **RatelGit**을 Applications로 끌어다 놓습니다. Developer ID로 서명하고 공증한 앱이라 보안 예외 없이 열립니다. 각 릴리스에 DMG의 SHA-256이 적혀 있으며 `shasum -a 256 <file>.dmg`로 확인할 수 있습니다.
- **Windows.** 설치 파일을 실행합니다. 코드 서명이 없어 SmartScreen이 알 수 없는 게시자라고 경고할 수 있습니다. **추가 정보 → 실행**을 고르세요. Windows 빌드는 CI에서 만들고 테스트하지만 실제 기기에서 실행해 보지는 못했습니다. [제한 사항](#제한-사항)을 참고하세요.

소스에서 직접 빌드하려면 Git 2.36 이상, Node.js 22, pnpm 10, 최신 안정 Rust 툴체인(과 플랫폼별 [Tauri 사전 요구 사항](https://tauri.app/start/prerequisites/))이 필요합니다.

```sh
git clone https://github.com/likeratel/ratelgit.git
cd ratelgit
pnpm install --frozen-lockfile
pnpm tauri build
```

앱은 `src-tauri/target/release/bundle/`에 만들어집니다. macOS 번들 이름은 `RatelGit.app`이고, 대문자 덕분에 Spotlight에서 `git`으로 찾을 수 있습니다. 응용 프로그램 폴더로 복사한 뒤 `src-tauri/target` 아래의 사본은 지워서 Spotlight에 두 개가 나오지 않게 하세요. 로컬에서 빌드한 앱은 서명·공증되지 않습니다.

ratelgit은 `PATH`의 `git`을 쓰고, 없으면 흔한 설치 위치(macOS는 `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, Windows는 `C:\Program Files\Git\cmd`)를 찾습니다. 찾지 못하거나 2.36보다 오래된 버전이면 Git의 원문 오류 대신 그렇다고 알려 줍니다.

## 빠른 시작

1. `⌘O`(Windows는 `Ctrl+O`)를 눌러 저장소나 그 linked worktree 폴더를 고릅니다. **Projects** 아래에 추가되고 다시 실행해도 남아 있습니다. 저장소는 원하는 만큼 추가할 수 있습니다.
2. 프로젝트 아래 worktree를 고르거나, `⌥⌘[`·`⌥⌘]`로 같은 프로젝트의 worktree를 차례로 오가거나, `⌘P`를 누르고 프로젝트·worktree·브랜치 이름 일부를 입력합니다. 각 worktree 행에는 브랜치, 변경 파일 수, upstream 대비 앞섬·뒤처짐이 표시됩니다.
3. 기본 화면은 **History**(`⌘1`)입니다. 처음에는 기본 필터, 곧 현재 브랜치와 `origin/main` 또는 `origin/master`가 걸려 있습니다. 목록 위 막대의 **Show All**은 모든 브랜치를 보여 주고 **Default**는 기본 필터로 되돌립니다. 커밋을 고르면 목록 아래에 메시지·파일·diff가 나타납니다.
4. **Changes**(`⌘2`)로 바꿔 파일·hunk·줄 단위로 스테이징하고 메시지를 쓴 뒤 **Commit**을 누릅니다.

Windows에서는 모든 `⌘` 단축키가 `Ctrl`입니다.

## 기능

### 프로젝트와 worktree

- 사이드바에 추가한 저장소와 각 저장소의 worktree가 나옵니다. 목록은 다시 실행해도 유지되고, 폴더가 사라진 프로젝트는 오류 대신 사용할 수 없음으로 표시됩니다. 프로젝트는 우클릭 메뉴에서 목록에서 뺄 수 있습니다.
- worktree를 바꾸면 그 작업 폴더의 그래프·브랜치·변경 파일·upstream 상태를 다시 읽고, 아무리 빠르게 바꿔도 마지막에 고른 worktree의 결과만 화면에 반영됩니다.
- 창이 다시 포커스를 얻으면 선택한 worktree와 사이드바 수치를 조용히 다시 읽어, 터미널이나 편집기에서 바꾼 내용이 나타납니다. 선택·초안·스크롤 위치는 그대로입니다.
- 마지막에 쓰던 worktree가 다음 실행 때 다시 열립니다. 커밋 메시지 초안은 앱을 켜 둔 동안 worktree별로 유지됩니다.
- `⌘P` 빠른 전환: 프로젝트, worktree, 현재 프로젝트의 브랜치를 퍼지 검색으로 고릅니다(`↑` `↓`, `Return`, `Esc`). 브랜치를 고르면 History가 그 브랜치로 필터링됩니다.

### History

- 커밋 목록이 창 위쪽을, 선택한 커밋의 상세가 아래쪽을 채웁니다. 왼쪽에 메시지·작성자·날짜·해시·부모와 변경 파일, 오른쪽에 선택한 파일의 diff가 나옵니다. 경계를 끌어 어느 쪽이든 넓힐 수 있고 비율은 기억됩니다.
- 모든 로컬 브랜치, 원격 브랜치, 태그와 HEAD를 함께, 또는 필터에 걸린 것만 그래프로 보여 줍니다. 레인과 머지 선은 색으로 구분되고, 주 줄기는 색을 유지하며 머지된 브랜치는 곡선으로 합류합니다.
- 열: 그래프, 참조 배지와 메시지, 작성자, 날짜, 짧은 해시. 목록이 좁아지면 작성자와 날짜를 숨깁니다. 로컬 브랜치와 같은 커밋에 있는 원격 브랜치는 로컬 배지 안의 작은 지구본으로 합쳐집니다.
- worktree에 변경이 있으면 맨 위에 **Uncommitted changes (n)** 행이 생기고, 누르면 Changes로 갑니다.
- 이력은 500개씩 읽고 끝까지 스크롤하면 다음 페이지를 가져옵니다. 다음 페이지에 부모가 있는 레인은 끊기지 않고 이어집니다. 목록은 가상 스크롤이라 긴 이력도 부드럽게 넘어갑니다.
- Fork 방식 필터:
  - 기본 필터는 현재 브랜치(체크아웃, detached HEAD, 고른 worktree를 따라감)와, 있으면 `origin/main`·`origin/master`입니다. 필터를 바꾸기 전까지 프로젝트는 기본 필터를 씁니다.
  - 사이드바의 브랜치·태그·원격 폴더·브랜치 폴더에 마우스를 올리고 깔때기를 누르면 거기서 닿는 커밋만 보입니다. 여러 필터를 켜면 합쳐서 보여 줍니다.
  - 목록 위 막대는 항상 보입니다. 켜진 필터("Current branch · main", `origin/main` 등)를 보여 주고 하나씩 뺄 수 있으며, worktree의 HEAD가 필터 밖이면 알려 줍니다. **Show All**은 모든 필터를 지우고 **Default**는 기본 필터로 되돌립니다. 기본 필터에서 브랜치를 더하거나 빼면 현재 브랜치가 포함된 사용자 필터가 됩니다.
  - `⌘⇧A`는 "현재 브랜치만"을 켜고 끕니다.
  - 필터는 프로젝트별로 저장되어 다시 실행해도 유지됩니다.
- 읽어 온 커밋 안에서 메시지·작성자·날짜·해시·참조 이름으로 검색합니다. 목록에 포커스가 있으면 `↑` `↓`로 커밋을 옮깁니다.
- 사이드바에서 브랜치·태그·stash를 누르면 그것이 가리키는 커밋이 선택됩니다.

### Changes

- 파일을 충돌, unstaged, untracked, staged로 묶어 보여 줍니다. 파일 행이나 diff 머리에서 파일 전체를 stage·unstage·discard합니다.
- diff에서 hunk 머리의 버튼으로 hunk 하나를 stage·unstage·discard하거나, 줄을 체크해 그 줄만 처리합니다. 코어는 사용자가 본 diff 그대로에서 패치를 다시 만들고, 그 사이 파일이 바뀌었으면 거부합니다.
- 파일 목록에 포커스가 있으면 `↑` `↓`로 파일을 옮기고 `Space`로 선택한 파일을 stage·unstage합니다. 메시지 칸에서 `⌘Return`을 누르면 커밋합니다.
- discard는 항상 먼저 확인합니다. untracked 파일을 discard하면 삭제된다는 점을 대화상자에 적습니다.
- 스테이징한 것이 있고, 메시지가 있고, 충돌 파일이 없어야 Commit이 켜집니다.

![hunk 버튼과 단어 단위 강조가 있는 작업 변경](docs/screenshots/changes.png)

### 충돌 해결

- merge·rebase·cherry-pick·revert가 멈추면(명령줄에서 시작한 경우 포함) 배너가 무엇을 합치는 중인지("Merging main into fix/login", "Rebasing topic onto main (step 2 of 3)" 등)와 남은 충돌 파일 수를 보여 줍니다. **Continue**는 모든 충돌이 해결·스테이징되어야 켜집니다. merge는 준비된 커밋 메시지를 편집할 수 있게 열고, rebase는 편집기를 띄우지 않고 이어 가며 다음 충돌에서 멈추면 그 상태를 보여 줍니다. **Abort**는 먼저 확인합니다.
- Changes의 첫 그룹은 **Conflicts**입니다. 파일마다 양쪽이 무엇을 했는지(양쪽 수정, 한쪽 삭제·다른 쪽 수정, 양쪽 추가 등)를 "ours/theirs" 대신 브랜치 이름으로 보여 줍니다. 파일 단위 동작: 한쪽 버전 그대로 쓰기, 삭제 충돌이면 파일 유지·삭제, 지금 상태로 해결 표시(충돌 마커가 남아 있으면 경고), 기본 앱으로 열기. 열면 무언가 실행될 수 있는 파일(스크립트, 프로그램, 실행 권한이 있는 파일)은 파일 관리자에서 위치만 보여 줍니다.
- 충돌 파일을 고르면 충돌 chunk마다 양쪽(`merge.conflictStyle`이 `diff3`·`zdiff3`이면 공통 base도)을 나란히 보여 주고, 마커에 적힌 이름으로 표시합니다. chunk마다 한쪽 또는 양쪽(순서 선택)을 고르고, 결과를 chunk 아래나 파일 전체 미리보기로 확인하며, 아직 고르지 않은 chunk로 이동할 수 있습니다. 모든 chunk를 골라야 **Save and Mark Resolved**가 켜지고, 그때서야 파일을 쓰고 stage합니다.
- 쓰기 전에 디스크의 파일이 보여 준 파일과 같은지 확인하고, 바뀌었으면 덮어쓰지 않습니다. 줄바꿈(LF·CRLF), 파일 끝 개행 유무, 인코딩을 유지합니다. 바이너리·비UTF-8 파일, 마커가 중첩되거나 깨진 파일은 추측하지 않고 파일 단위 동작만 제공합니다.

![충돌 chunk의 양쪽과 고른 결과를 보여 주는 충돌 파일](docs/screenshots/conflicts.png)

### Diff

- Unified와 Split 레이아웃, 둘 다 줄 번호가 있습니다.
- 바뀐 줄 쌍에서는 다른 단어만 강조합니다.
- **Ignore whitespace**는 공백만 바뀐 변경을 숨깁니다(`git diff -w`). 이런 diff는 다시 적용할 수 없어서 켜져 있는 동안 hunk·줄 스테이징이 꺼집니다.
- 아주 큰 diff는 4MB에서 자르고, UTF-8이 아닌 diff는 대체 문자로 보여 줍니다. 두 경우 모두 hunk·줄 스테이징이 꺼지고 파일 전체는 여전히 스테이징할 수 있습니다.

### 브랜치, stash, 원격

- 로컬 브랜치와 원격 브랜치는 `/` 기준 폴더 트리로 보여 주고, 원격마다 최상위 폴더가 됩니다. 현재 worktree가 체크아웃한 브랜치는 강조되고, 다른 worktree가 체크아웃한 브랜치에는 그 worktree 이름을 알려 주는 아이콘이 붙습니다.
- 로컬 브랜치 메뉴: 체크아웃, 현재 브랜치로 merge, 현재 브랜치를 그 위로 rebase, 새 worktree로 체크아웃…, 이름 바꾸기…, 삭제…, 필터. 새 worktree는 입력한 이름의 폴더로, 프로젝트 옆이나 시스템 폴더 선택 창에서 고른 폴더 안에 만들어집니다. 삭제는 먼저 확인하고, 완전히 merge되지 않은 브랜치는 따로 한 번 더 확인해야 강제 삭제됩니다.
- 원격 브랜치 메뉴: 로컬 추적 브랜치로 체크아웃, 필터. 태그도 필터할 수 있습니다.
- stash 메뉴: 적용(커밋 ID로 적용하므로 stash 번호가 밀려도 엉뚱한 stash가 적용되지 않음), 확인 후 삭제.
- **⋯** 메뉴에서 HEAD로부터 브랜치를 만들거나 변경을 stash합니다. Fetch, Pull, Push는 위쪽 막대에 있습니다.

## 단축키

| macOS     | Windows        | 동작                                          |
| --------- | -------------- | --------------------------------------------- |
| `⌘O`      | `Ctrl+O`       | 저장소 추가                                   |
| `⌘P`      | `Ctrl+P`       | 프로젝트·worktree·브랜치로 빠른 전환          |
| `⌘R`      | `Ctrl+R`       | 새로 고침                                     |
| `⌘1`      | `Ctrl+1`       | History                                       |
| `⌘2`      | `Ctrl+2`       | Changes                                       |
| `⌘⇧A`     | `Ctrl+Shift+A` | History에서 "현재 브랜치만" 켜고 끄기         |
| `⌥⌘[`     | `Ctrl+Alt+[`   | 프로젝트의 이전 worktree                      |
| `⌥⌘]`     | `Ctrl+Alt+]`   | 프로젝트의 다음 worktree                      |
| `Space`   | `Space`        | 선택한 파일 stage·unstage(파일 목록에 포커스) |
| `⌘Return` | `Ctrl+Enter`   | 커밋(메시지 칸에 포커스)                      |

단축키는 물리 키 위치로 판단하므로 한글 등 다른 입력 소스에서도 동작합니다.

## 제한 사항

- **Windows**는 푸시마다 CI에서 빌드되고 Git 코어의 통합 테스트와 브라우저 테스트도 거기서 통과하지만, 앱 자체를 Windows 기기에서 열어 본 적은 없습니다. 창, 단축키, 설치 파일, 콘솔 창 없는 Git 실행은 실사용으로 확인하지 못했습니다.
- macOS의 시스템 라이트·다크 모양에서만 확인했습니다. Linux는 대상이 아닙니다.
- 검색은 지금까지 읽어 온 커밋에서만 합니다.
- merge 커밋의 파일은 첫 번째 부모와 비교합니다.
- hunk·줄 스테이징은 추적 중인 UTF-8 텍스트 파일에서 됩니다. untracked·새 파일은 파일 전체로 스테이징합니다. 파일 마지막 줄 끝에 개행이 없으면 그 주변 줄은 함께만 스테이징할 수 있고, 앱이 그렇게 안내합니다(hunk 버튼은 그대로 동작). 실행 권한 같은 mode 변경은 파일 전체로만 스테이징됩니다.
- 충돌 chunk는 표준 7글자 마커로 읽습니다. `conflict-marker-size` 속성은 지원하지 않습니다. 해결 결과를 직접 고치는 편집기는 없으니 외부 편집기로 여세요. rebase 단계를 앱에서 건너뛸 수는 없습니다.
- 결과가 빈 cherry-pick·revert는 앱에서 이어 갈 수 없고, 앱에서 할 수 있는 것은 **Abort**뿐입니다. 유지하려면 터미널에서 `git cherry-pick --skip` 또는 `git commit --allow-empty`로 마무리하세요. 진행 중인 `git am`은 표시하지 않습니다.
- partial clone(예: `git clone --filter=blob:none`)에서 아직 받지 않은 파일 내용은 보여 줄 수 없습니다. ratelgit은 읽을 때 절대 가져오지 않기 때문입니다. diff 영역에 그렇게 안내하니 터미널에서 가져오세요.
- merge·rebase 메뉴는 로컬 브랜치에만 있습니다.
- 커밋 메시지 초안은 앱이 켜져 있는 동안만 유지됩니다.
- 이름에 개행이나 백슬래시(Windows에서는 콜론도)가 든 파일은 앱에서 스테이징하거나 볼 수 없습니다.
- undo, cherry-pick·revert·reset 명령, interactive rebase, 드래그 앤 드롭, 원격 관리, 서브모듈은 없습니다. 명령줄을 쓰세요.
- pull은 fast-forward만 합니다. pull과 push에는 현재 브랜치의 원격 upstream이 필요합니다. 네트워크 명령은 5분이 지나면 멈춥니다.
- 원격 인증은 기존 Git 자격 증명 설정을 씁니다. ratelgit은 자격 증명을 묻거나 저장하지 않으며, Git이 물어야 하는 상황이면 Git의 메시지와 함께 실패합니다.
- 아주 큰 저장소는 측정하지 않았습니다. 이력은 페이지 단위로 읽고 가상 스크롤하지만, worktree 목록을 읽을 때 프로젝트의 모든 worktree에서 변경 수를 셉니다.

## 신뢰 모델

신뢰하는 저장소만 추가하세요. ratelgit은 컴퓨터에 설치된 Git을 실행하고, Git은 각 저장소의 설정을 읽습니다. ratelgit은 읽기만 할 때 끌 수 있는 것은 끕니다(서명 확인, `core.fsmonitor`, 외부 diff·textconv 프로그램, 모든 네트워크 전송, partial clone의 누락 객체 가져오기). 하지만 일부 설정된 프로그램은 명령줄에서와 똑같이 실행됩니다. 상태를 읽을 때의 clean·smudge 필터, 커밋·merge·rebase·체크아웃 때의 훅이 그렇습니다. 신뢰할 수 없는 곳에서 온 저장소는 추가하는 순간 이것들을 통해 명령을 실행할 수 있습니다. fetch·pull·push는 Git처럼 저장소의 원격 설정을 따릅니다.

## 개발

필요한 것: Node.js 22, pnpm 10, 최신 안정 Rust 툴체인, Git.

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm dev`만 실행하면 `http://localhost:1420`에서 코어 대신 메모리 안의 대역(예제 프로젝트, 멈춘 merge, 충돌 포함)을 쓰는 UI가 브라우저로 열립니다. 브라우저 테스트가 이것을 씁니다.

### 확인

```sh
pnpm check
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
pnpm format:check
cd src-tauri
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

Rust 통합 테스트는 임시 저장소, worktree, 로컬 원격을 만들어 쓰며 사용자의 저장소는 건드리지 않습니다.

UI와 Rust 코어는 [CONTRACT.md](CONTRACT.md)의 명령으로만 통신합니다. `src-tauri/tests/contract.rs`가 실제 코어 응답을 `src/bridge/fixtures/core-samples.json`에 기록하고, UI 테스트가 앱과 같은 zod 스키마로 그것을 검사하므로, 한쪽만 바뀌면 테스트가 실패합니다. 풀 리퀘스트 전에 [CONTRIBUTING.md](CONTRIBUTING.md)를 읽어 주세요.

## 라이선스

[MIT](LICENSE)
