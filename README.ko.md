# ratelgit

[English](README.md) · 한국어

<img src="docs/ratelgit.png" alt="벌꿀오소리의 투톤 무늬 위에 커밋 그래프를 얹은 ratelgit 아이콘" width="128" />

ratelgit은 worktree를 중심에 둔 macOS Git 클라이언트입니다. 사이드바에서 worktree를 고르면 커밋 그래프, 변경 파일, diff가 함께 바뀌어서, 한 저장소의 여러 작업 폴더를 오가도 흐름이 끊기지 않습니다. 이름은 벌에 몇 번 쏘여도 물러서지 않는 벌꿀오소리(ratel)에서 따왔습니다. Swift와 SwiftUI로 만들었고, 이미 설치된 Git 명령줄을 사용합니다.

> AI와 함께 만들었습니다. 방향은 제가 정했고, 코드·테스트·문서는 [Codex](https://openai.com/codex/)와 [Claude Code](https://claude.com/claude-code)와의 세션에서 작성했습니다. [왜 만들었나](#왜-만들었나)를 참고하세요.

![선택한 worktree의 변경 파일과 unified diff](docs/screenshots/changes.png)

스크린샷은 가상의 커밋으로 만든 예제 저장소를 렌더링한 것입니다.

## 목차

- [왜 만들었나](#왜-만들었나)
- [설치](#설치)
- [빠른 시작](#빠른-시작)
- [기능](#기능)
- [단축키](#단축키)
- [제한 사항](#제한-사항)
- [개발](#개발)
- [라이선스](#라이선스)

## 왜 만들었나

같은 저장소의 worktree를 여러 개 열어 두고 일하는데, Git 클라이언트에 바라는 것은 단순했습니다. worktree를 고르면 그 그래프와 diff가 보이는 것입니다. Sourcetree, Fork, GitKraken은 일상적인 Git 기능을 잘 다루지만 worktree 사이를 오가는 일이 중심은 아닙니다. ratelgit은 그 기본기(브랜치, 커밋 그래프, 스테이징, diff 뷰어, fetch·pull·push)를 가져오고 worktree 목록을 맨 앞에 두었습니다.

제가 한 일: 조회 전용 브라우저에서 시작해 스테이징·커밋·원격 작업을 더하는 순서로 범위를 정했고, 안전 규칙(pull은 fast-forward만, push는 설정된 upstream으로의 일반 push)을 골랐습니다. 구현·테스트·문서는 Codex와 Claude Code로 작성했고, 단계마다 독립 리뷰를 거쳤습니다.

## 설치

아직 패키지 릴리스가 없어 소스에서 빌드합니다. macOS 14 이상과 Xcode 15 이상이 필요합니다. Xcode가 기본 개발자 디렉터리가 아니면 `DEVELOPER_DIR`에 Xcode의 `Contents/Developer` 경로를 지정하세요.

```sh
git clone https://github.com/likeratel/ratelgit.git
cd ratelgit
./scripts/run-app.sh
```

스크립트는 `.build/RatelGit.app`을 만들고 실행합니다. Spotlight로 실행하려면 번들을 응용 프로그램 폴더로 복사하세요.

```sh
./scripts/run-app.sh --build-only
cp -R .build/RatelGit.app ~/Applications/
```

## 빠른 시작

1. `⌘O`를 눌러 저장소 또는 연결된 worktree 폴더를 고릅니다.
2. **Worktrees**에서 작업 폴더를 고르거나 `⌥⌘[`, `⌥⌘]`로 전환합니다. 각 행에 브랜치와 변경 파일 수가 표시됩니다.
3. **Changes**에서 파일을 선택해 diff를 보고, `+` 버튼으로 스테이징한 뒤 메시지를 쓰고 **Commit**을 누릅니다.
4. **History**로 바꿔 그래프를 따라가고, 커밋을 선택해 파일과 diff를 확인합니다.

## 기능

### Worktree

- 저장소의 모든 worktree를 브랜치·변경 수와 함께 보여 주고, 이름이나 브랜치로 걸러 볼 수 있습니다.
- worktree를 바꾸면 그 작업 폴더의 그래프, 브랜치, 변경 파일, upstream 상태를 다시 읽습니다.
- 커밋 메시지 초안은 앱을 사용하는 동안 worktree마다 따로 유지됩니다.

### Changes

- 파일을 unstaged, untracked, staged로 나눠 보여 주고 파일 단위로 stage·unstage합니다.
- 스테이징한 변경과 메시지가 있고 충돌 파일이 남아 있지 않을 때만 커밋할 수 있습니다.

### History

- 브랜치 레인과 머지 연결선을 색상 그래프로 그립니다. 메인 라인은 색을 유지하고 머지된 브랜치가 그쪽으로 합류합니다.
- 메시지, 작성자, 날짜, 해시, 참조 이름으로 검색합니다.
- 사이드바에서 로컬 브랜치, 원격 브랜치, 태그, stash를 선택해 해당 이력을 봅니다.

![머지가 있는 커밋 그래프와 선택한 커밋의 파일·diff](docs/screenshots/history.png)

### Diff

- Unified와 Split 보기를 지원하며 둘 다 줄 번호를 표시합니다.
- Split 보기는 가장 긴 줄의 실제 너비를 재므로, 긴 줄이나 한글처럼 넓은 글자도 자기 열 안에 머뭅니다.

### 브랜치, stash, 원격

- 현재 HEAD에서 브랜치를 만들거나, 로컬 브랜치를 우클릭해 체크아웃합니다.
- staged·unstaged·untracked 변경을 stash하고, stash를 우클릭해 적용합니다.
- Fetch, Pull, Push는 상단에 있고, 옆에 upstream 대비 앞선·뒤처진 커밋 수가 표시됩니다.

## 단축키

| 단축키 | 동작          |
| ------ | ------------- |
| `⌘O`   | 저장소 열기   |
| `⌘R`   | 새로 고침     |
| `⌥⌘[`  | 이전 worktree |
| `⌥⌘]`  | 다음 worktree |

## 제한 사항

- History는 선택한 참조의 최신 커밋을 최대 400개 표시합니다.
- 머지 커밋의 파일은 첫 번째 부모와 비교합니다.
- 스테이징은 파일 단위입니다. hunk·줄 단위 스테이징과 변경 버리기는 없습니다.
- Pull은 fast-forward만 허용합니다. Pull과 Push에는 현재 브랜치의 원격 upstream이 필요합니다.
- merge, rebase, 브랜치 삭제, worktree 생성은 아직 없습니다. 명령줄을 사용하세요.
- 원격 인증에는 기존 Git 자격 증명 설정을 사용하며, ratelgit은 자격 증명을 저장하지 않습니다.

## 개발

```sh
swift build
swift test
```

`swift test`에는 Xcode의 XCTest가 필요합니다. 통합 테스트는 임시 저장소·worktree·로컬 원격 저장소를 만들어 쓰며 사용자의 저장소는 건드리지 않습니다.

구성은 단순합니다. `Sources/RatelGitCore`가 Git을 실행하고 출력을 해석하며, `Sources/RatelGit`에 SwiftUI 앱이 있고, `scripts/make-icon.swift`가 앱 아이콘을 다시 그립니다.

## 라이선스

MIT
