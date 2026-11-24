# Contributing

Thanks for your interest in ratelgit. It is a small Git client built around worktrees, so
contributions are expected to stay inside that scope.

## Ground rules

- The UI and the Rust core talk only through [CONTRACT.md](CONTRACT.md). When you change a
  command or a payload, update the contract, the Rust models, the zod schemas in
  `src/bridge/types.ts` and the recorded samples
  (`UPDATE_CONTRACT_SAMPLES=1 cargo test --test contract` in `src-tauri`) together.
- Run Git with fixed argument lists. Never build a shell command string. Validate every IPC
  input in the core: branch names with `git check-ref-format`, paths after `--` with literal
  pathspecs, commit IDs by format, and every worktree path against the registered projects.
- Anything that cannot be undone (discarding changes, deleting a branch or stash, deleting a
  conflicted file, aborting a merge or rebase) asks for confirmation first.
- A failure must be shown as a failure. Do not swallow Git's error text.
- Conflict resolution writes nothing until every chunk has a choice, refuses to overwrite a file
  that changed since it was read, and keeps line endings and encoding.
- ratelgit never prompts for or stores credentials. It uses the user's Git setup as it is.
- Keep platform-specific code behind `#[cfg(...)]` and keep the Windows build compiling.
- Sample data, tests and screenshots use made-up names only.
- Keep the README honest about what is supported and what has been verified.

## Development setup

See the [README](README.md#development) for prerequisites. In short:

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm dev` runs the UI in a browser against the in-memory fake core in `src/bridge/fake`.

## Checks before a pull request

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

For visual changes, write screenshots with
`SHOTS_DIR=/some/folder pnpm test:e2e tests/screens.spec.ts` and look at them in light and dark
mode and at the minimum window size (1050×630).

## Releases

1. Set the same version in `package.json`, `src-tauri/Cargo.toml` (then `Cargo.lock`) and `src-tauri/tauri.conf.json`, and commit.
2. Push a tag `vX.Y.Z` on that commit. `.github/workflows/release.yml` checks the tag against the three manifests, builds the Windows installers and attaches them to a draft GitHub Release. They are not code signed.
3. On a Mac with the Developer ID certificate, build the universal app (`pnpm tauri build --target universal-apple-darwin --bundles app,dmg` with `APPLE_SIGNING_IDENTITY` set), notarize and staple the app, put the stapled app into the disk image, sign, notarize and staple the image, and upload it to the draft.
4. Write the release notes with the DMG's SHA-256 and publish the draft.
5. Delete the app bundles left under `src-tauri/target` so Spotlight lists only the installed app.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/), for example `feat: add tag menu`.
