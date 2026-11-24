# ratelgit

로컬 저장소의 worktree를 빠르게 오가며 Git 이력과 변경을 확인하고 커밋하는 macOS 클라이언트입니다.

## 실행

macOS 14 이상에서 실행됩니다. 소스에서 빌드하려면 Xcode 15 이상을 선택하거나 `DEVELOPER_DIR`로 Xcode의 `Contents/Developer` 경로를 지정하세요.

```sh
./scripts/run-app.sh
```

⌘O로 저장소 또는 연결된 worktree를 엽니다. 왼쪽의 **Worktrees**에서 작업 폴더를 고르거나 ⌥⌘[와 ⌥⌘]로 전환합니다. ⌘R로 새로 고칩니다.

- **Changes**에서 상태별 파일과 diff를 보고, 파일을 stage·unstage하거나 스테이징한 변경을 커밋합니다. 커밋 메시지 초안은 앱을 사용하는 동안 worktree마다 따로 유지됩니다.
- **History**에서 브랜치와 머지 흐름을 색상 그래프로 봅니다. 작성자, 날짜, 메시지, 해시, 참조 이름을 검색할 수 있습니다. 선택한 이력에서 최신 커밋을 최대 400개 표시하며, 머지 커밋의 파일은 첫 번째 부모와 비교합니다.
- 오른쪽에서 줄 번호가 있는 **Unified / Split** diff를 전환합니다.
- **Actions**에서 브랜치를 만들거나 변경을 stash할 수 있습니다. 사이드바의 로컬 브랜치와 stash를 우클릭하면 체크아웃과 적용 동작이 표시됩니다.
- **Fetch / Pull / Push**를 상단에서 실행합니다. Pull은 fast-forward만 허용하며, Pull과 Push에는 원격 upstream 설정이 필요합니다. 원격 인증에는 기존 Git 자격 증명 설정을 사용합니다.

## 테스트

`swift test`는 Xcode의 XCTest가 필요합니다. 통합 테스트는 임시 worktree와 로컬 원격 저장소를 사용합니다.
