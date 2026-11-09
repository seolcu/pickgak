# AGENTS.md

Guide for coding agents (and humans) working on PickGak (픽각), an Overwatch hero-pick helper. Read this before changing anything.

## What lives where

| Path | What | Stack |
| --- | --- | --- |
| `backend/` | API and stats collector (Nexon/Blizzard public stats, counterwatch matchups), recommendation, party and ban engine, accounts | Python 3.14, FastAPI, SQLite, uv |
| `backend/data/` | Tunable YAML: weights, counters, comps, bans, queues | YAML |
| `frontend/` | The React UI, used by the website and by the desktop app's webview | React 19, Vite, Tailwind 4, TanStack Query, i18next |
| `app/` | Desktop app v2 (Tauri 2): TAB-triggered scoreboard capture, overlay | Rust |
| `app/crates/vision` | Reads a captured frame: scoreboard layout, portraits, stats digits, bans, rank range, map text | pure Rust |
| `app/crates/live` | XInput2 raw TAB events and an X11 grab of the game window | Rust, x11rb |
| `app/src-tauri` | Tray, overlay window, API proxy, capture processing, teach-once templates | Tauri |
| `docs/` | `v2.md` (desktop architecture, safety, measured numbers, edge cases), `writing-style.md`, `team-building.md`, `ux-metrics.md`, `brand.md` | Markdown |

Production runs on a self-hosted server (`pickgak.seolcu.com`); deploying it is not part of this repository (see Workflow).

## Commands

Backend (in `backend/`):
```bash
uv sync
uv run pytest -q
uv run ruff check app tests && uv run ruff format --check app tests
uv run uvicorn app.main:app --reload        # http://localhost:8000
```

Frontend (in `frontend/`):
```bash
npm ci
npm run dev        # http://localhost:5173, proxies /api to localhost:8000
npm run lint       # eslint + i18n key check (every key in every language)
npm test           # vitest
npm run build      # tsc -b && vite build
```

Desktop app (in `app/`). The host has no Rust or WebKit dev libraries, so build and test inside the `pickgak-app-build` container:
```bash
docker build -t pickgak-app-build app/docker
docker run --rm -v "$PWD":/repo -v pickgak-cargo:/cargo -v pickgak-target:/target \
  -v pickgak-npm:/root/.npm -w /repo/app pickgak-app-build bash -c '
    cargo fmt --all && cargo clippy --all-targets -- -D warnings &&
    cargo test --release -p pickgak-vision -p pickgak-live &&
    scripts/build-linux.sh'                    # -> app/dist/*.rpm, *.deb
```
- **E2E on a virtual display** (inside the container):
  - `scripts/e2e-app.sh`, `scripts/e2e-app-range.sh`: the whole app.
  - `scripts/e2e-focus.sh`: when TAB counts, repeat capture.
  - `scripts/e2e-live.sh`, `scripts/e2e-perf.sh`.
  - `scripts/e2e-overlay-drag.sh`: the overlay moves when unlocked and stays put when locked.
- **Gotcha**: write their output to a file, then read the file. Piping into `grep` hangs on the background X processes.
- **Regression over real captures**: `cargo run --release -p pickgak-vision --example read_dir -- <folder>` prints what the app reads from every image in a folder. The user's saved captures are in `../pickgak-captures/` (outside the repo; they show players' names). Diff the output before and after any vision change.

CI (`.github/workflows/ci.yml`) runs:
- backend: ruff, pytest
- frontend: lint, test, build
- desktop core: fmt, clippy, tests for the two Rust crates

All three must pass before merging. They run on `ubuntu-latest` (free for a public repository); a small `pick` job skips the parts a change does not touch. Never add a self-hosted runner to this public repository: any fork's pull request could run code on it.

Release builds (`.github/workflows/release.yml`) run when a GitHub release is published, also on GitHub-hosted runners. Each job is a repo script, so they also run by hand:
- `app/scripts/build-windows.sh`: the NSIS installer, cross-built with cargo-xwin; it also compiles the Windows capture backend
- `app/scripts/build-linux-release.sh`: the bundled OCR engine and the app shell's tests, one start on a virtual display, the signed Flatpak repository and the rpm/deb/AppImage

## Rules

### Language and writing
Full rules are in `docs/writing-style.md`. The short version:
- **English first on GitHub**: commits, PR titles and bodies, release notes, README, docs. Korean versions are secondary files (`README.ko.md`).
- **The UI follows the browser locale** (ko or en; a pick in the UI overrides it).
  - Every user-facing string goes in `frontend/src/locales/{ko,en}/<area>.json`.
  - `npm run lint` fails on a missing key.
- **Korean UI** follows Apple's Korean UI: 합니다체 for sentences, 하십시오체 for instructions, -겠습니까? for confirmations, noun forms (복사됨, 결과 없음) for short states, noun phrases for labels and buttons. No 해요체.
  - Every full sentence ends with a period; noun forms and labels never do.
  - Roles are 돌격/공격/지원.
- **No AI tells**: no "not A but B" framing, no dashes as connectors, no slogans, intensifiers or bold sprinkled through prose. The list is in `docs/writing-style.md`.
- **No emoji** anywhere: code, UI, docs, commits, PRs.
- **Code comments** follow the file: Korean in `backend/` and `frontend/`, English in `app/` (Rust).

### Safety (non-negotiable)
PickGak never touches the game: no process injection, no memory reads, no packet capture, no game files. The desktop app does only two things:
- **Keyboard**: it observes TAB through XInput2 raw events, never grabbing the key. Every other key is dropped on arrival and never stored or logged.
- **Screen**: it copies pixels of the game window while TAB is held, and only while the game has focus.

Don't propose or add anything beyond that, such as OCR of other apps, memory reading, packet sniffing, or scraping Blizzard player profiles. Player mastery features were dropped on purpose.

### Security
Treat every change as security-relevant and check before calling it done:
- **API**:
  - auth, CSRF/origin checks, rate limits
  - input bounds (`StringConstraints`, `Field(max_length=...)`)
  - parameterized SQL
  - no path traversal (e.g. `downloads.py` only serves names listed in `latest.json`)
- **Desktop app**:
  - the API proxy only allows paths under `/api` on the configured server
  - captures and templates stay local
  - the webview CSP stays strict
- **Never commit secrets.** Signing keys and server credentials stay out of git.

### Vision changes (`app/crates/vision`)
- **Thresholds are measured.** When you add or change one, write what it separates and the measured numbers next to the constant, as the existing ones do.
- **New cases come from real captures.** Add a small fixture under `tests/fixtures/` and a test in `tests/recording.rs`. That folder is the private `pickgak-fixtures` submodule (real matches carry players' names): commit the capture there, then the submodule pointer here (`git submodule update --init` after cloning). Never put a player's name in this repository's code or comments; CI has no access to the captures, so those tests skip there and must pass locally.
- **Prefer leaving a value unread to guessing.** The board keeps what it had, and a wrong hero is worse than none.
- **Geometry is relative to the frame height and the detected table**, not raw width fractions (16:10, 21:9, 4K). The tests include scaled and pillarboxed frames.
- **Built-in templates are generated, never hand-edited:**
  - hero portraits from Namu Wiki 2D portraits
  - ban icons from Nexon thumbnails
  - tier emblems from owtics
  - Rebuild them with `uv run --with pillow python app/scripts/make-seeds.py`.
  - The `"?"`, skull and empty-row states come from fixtures: `cargo run -p pickgak-vision --example make_states`.

### Frontend
- The same UI runs on the website and inside the desktop app. Gate app-only behavior on `isDesktop` (`src/lib/platform.ts`); talk to Tauri only through `invoke`/`listen` there.
- **Check mobile (390 px) and desktop (1440 px).** The mobile bottom tab bar covers the last 64 px.
- **`cn()` is plain `clsx`, not tailwind-merge.** A `hidden` passed to a component that already sets `inline-flex` doesn't reliably win. Hide a wrapper element instead.
- Live TAB readings are applied as a diff against the previous capture (`diffReading`), so manual edits survive repeated captures. Keep it that way.

## Workflow

- **Branches**: never commit to `main` directly. Branch (`feat/...`, `fix/...`), open a PR, wait for CI, merge with a merge commit, delete the branch.
- **Commit and PR text**: English, a short summary line plus the why. End commits with the co-author line the session asks for, without emoji.
- **Desktop releases**:
  1. Bump `version` in `app/Cargo.toml` and `app/package.json`, and the `<release>` version in `app/flatpak/com.seolcu.pickgak.metainfo.xml` (Flatpak shows it).
  2. Merge to main, then `gh release create vX.Y.Z-alpha.N --prerelease --target main --title ... --notes ...`. The release workflow attaches the installer and packages, then `latest.json`, publishes the Flatpak repository on GitHub Pages and pushes `ghcr.io/seolcu/pickgak:<tag>`. Watch it with `gh run watch`; if a job fails, fix it and run the workflow again for the same tag (Actions tab, or `gh workflow run release.yml -f tag=<tag>`).
  3. The server's `/api/app/latest` (the `/download` page and the app's updater) picks the release up within 5 minutes, once `latest.json` is attached. Downloads go straight to the GitHub release files.
- **Deploying the website and backend is not part of this repository.** The server runs the `ghcr.io/seolcu/pickgak` image; a separate private ops repo, checked out next to this one, pins the version and holds the steps (its `AGENTS.md` and `docs/services/pickgak.md`). Host names, users and paths belong there, not here: this repository is public.
  - These touch production, so the user runs them, or confirms them first.
  - Verify afterwards with `curl https://pickgak.seolcu.com/api/config`.
  - A frontend-only change also needs this deploy to reach the website.

## Things that already burned time

- **Prove a "no source exists" claim before giving up on it.** The TAB scoreboard portraits are the Namu Wiki "2D 초상화" art; the ban strip uses Nexon's hero thumbnails.
- **Don't bypass anti-bot pages** (e.g. Fandom's Cloudflare challenge). Find another source.
- **GNOME on Wayland**:
  - The game runs on XWayland, and the app forces `GDK_BACKEND=x11` so always-on-top works.
  - Mutter deletes `_NET_ACTIVE_WINDOW` (it doesn't set it to 0) while a Wayland-native window has focus.
- **Tauri overlay**: show the window before setting click-through, or tao panics.
