# ratelgit

worktree를 빠르게 오가며 이력과 변경을 보는 macOS Git 클라이언트. Swift, SwiftUI, 로컬 Git CLI.

- 라이선스는 MIT다. 로컬 Git 커밋은 허용되지만 push·릴리스·저장소 공개 범위 변경은 사용자 요청이 해당 행동까지 허용하는지 확인한다.
- Git 명령은 인수 배열로 실행하고 셸 문자열을 조합하지 않는다. 사용자 입력 브랜치 이름과 경로는 검증한다.
- 모든 Git 명령은 선택한 worktree 경로에서 실행한다. 빠르게 전환해도 마지막에 선택한 worktree의 결과만 화면에 반영한다.
- 되돌릴 수 없는 동작(변경 버리기, 브랜치 삭제, stash 삭제)은 확인을 거친다. 실패를 성공처럼 표시하지 않는다.
- 화면 검증은 오프스크린 렌더링으로 한다. 실행 중인 앱을 클릭하거나 키 입력을 보내 사용자의 포커스를 뺏지 않는다.
- 번들 이름은 `RatelGit.app`이다. 대문자가 Spotlight에 단어 경계를 주어 `git`으로 검색된다. 실행 파일과 저장소 이름은 `ratelgit` 그대로 둔다.
- 확인: `swift build`, `swift test` (Xcode의 XCTest 필요).
- 릴리스를 게시했거나 빌드한 앱을 Applications에 설치한 뒤에는 프로젝트 안에 남은 앱 번들(`.build/RatelGit.app`, `.build/install-backup.*`)을 지운다. 남겨 두면 Spotlight에 설치본과 빌드 산출물이 함께 검색된다.
