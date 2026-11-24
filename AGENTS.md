# ratelgit

worktree를 빠르게 오가며 이력과 변경을 보는 Git 클라이언트. Tauri 2 + React + TypeScript, Rust core, 로컬 Git CLI. macOS 우선, Windows는 CI 빌드만 확인.

- 라이선스는 MIT다. 로컬 Git 커밋은 허용되지만 push·릴리스·저장소 공개 범위 변경은 사용자 요청이 해당 행동까지 허용하는지 확인한다.
- UI와 core는 `CONTRACT.md`의 명령으로만 통신한다. 계약을 바꾸면 `CONTRACT.md`, Rust 모델, `src/bridge/types.ts`의 zod 스키마, `src/bridge/fixtures/`의 표본(`UPDATE_CONTRACT_SAMPLES=1 cargo test --test contract`)을 함께 고친다.
- Git 명령은 인수 배열로 실행하고 셸 문자열을 조합하지 않는다. 브랜치 이름은 `check-ref-format`, 경로는 `--`와 literal pathspec, 해시는 형식을 검사한다. Windows에서는 콘솔 창이 뜨지 않게 실행한다.
- 모든 Git 명령은 core가 등록된 프로젝트의 worktree인지 확인한 경로에서 실행한다. 빠르게 전환해도 마지막에 선택한 worktree의 결과만 화면에 반영한다(스토어의 요청 세대 번호).
- 되돌릴 수 없는 동작(변경 버리기, 브랜치 삭제, stash 삭제, 충돌 파일 삭제, merge·rebase 중단)은 확인을 거친다. 실패를 성공처럼 표시하지 않는다.
- 충돌 해결은 모든 chunk를 고르기 전에는 파일을 쓰지 않고, 쓰기 직전 파일이 바뀌었으면 거부한다. 줄바꿈·파일 끝 개행·인코딩을 보존한다. 깨진 마커는 추측하지 않는다.
- 저장소 설정은 신뢰하지 않는다. 읽기 명령에는 프로그램 실행·네트워크를 끄는 `-c` 설정과 `GIT_NO_LAZY_FETCH=1`을 유지하고(`src-tauri/src/git/runner.rs`), 막을 수 없는 필터·훅은 README의 신뢰 모델 절에 적는다.
- 자격 증명을 묻거나 저장하지 않는다(`GIT_TERMINAL_PROMPT=0`). 앱 자체는 네트워크를 쓰지 않고, fetch·pull·push만 Git이 원격에 접속한다.
- 플랫폼 전용 코드는 `#[cfg(target_os)]`·`#[cfg(windows)]`로 분리하고 Windows에서도 컴파일되게 유지한다.
- 화면 검증은 headless 브라우저(Playwright)와 테스트로 한다. 실행 중인 앱을 클릭하거나 키 입력을 보내 사용자의 포커스를 뺏지 않는다. 스크린샷은 `SHOTS_DIR=<폴더> pnpm test:e2e tests/screens.spec.ts`.
- 예제 데이터·테스트·스크린샷에는 가상의 이름만 쓴다.
- macOS 번들 이름은 `RatelGit.app`이다(`src-tauri/tauri.macos.conf.json`). 대문자가 Spotlight에 단어 경계를 주어 `git`으로 검색된다. 실행 파일·식별자·저장소 이름은 `ratelgit` 그대로 둔다.
- TypeScript 확인: `pnpm check`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm format:check`.
- Rust 확인: `cargo fmt --check`, `cargo test`, `cargo clippy --all-targets -- -D warnings` (src-tauri).
- 릴리스를 게시했거나 빌드한 앱을 Applications에 설치한 뒤, 또는 `pnpm tauri build`로 확인만 한 뒤에는 프로젝트 안에 남은 앱 번들(`src-tauri/target/**/bundle/macos/*.app`)을 지운다. 남겨 두면 Spotlight에 설치본과 빌드 산출물이 함께 검색된다. DMG 등 릴리스 산출물은 지우지 않는다.
