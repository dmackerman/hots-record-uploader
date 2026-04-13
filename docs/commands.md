
## Uploader — Packaging & GitHub Releases

The `uploader/` directory is an Electron app built with Electron Forge. It produces:

- **Windows**: `.exe` installer via Squirrel (`@electron-forge/maker-squirrel`)
- **macOS**: `.dmg` and `.zip` via the DMG/ZIP makers

### 1. Bump the version

```bash
# In uploader/package.json, update "version": "x.y.z"
# Use semver — e.g. 0.1.0 → 0.2.0 for features, → 0.1.1 for fixes
```

### 1a. Replace a version

If you need to fix a release after tagging (e.g. forgot to add the squirrel authors for Windows), update the code, then:

```bash
git tag -d v0.1.0
git push origin :refs/tags/v0.1.0
git tag v0.1.0
git push origin v0.1.0
```

### 2. Build release artifacts

Run these on each target OS (or on the OS you want to ship for — Electron builds are platform-native):

```bash
cd uploader
npm run make
```

Artifacts land in `uploader/out/make/`:

- `squirrel.windows/` → `hots-replay-uploader-<version> Setup.exe`
- `zip/darwin/` → `HoTS Replay Uploader-<version>-arm64.zip` (Apple Silicon)
- `dmg/` → `HoTS Replay Uploader-<version>-arm64.dmg`

### 3. Create a GitHub Release

**Yes — you can use a private repo.** GitHub Releases work identically on private repos. Users with repo access can download the assets directly. If you ever want public distribution, flip the repo to public; no other changes needed.

```bash
# Tag the release commit
git -C uploader tag v<version>   # e.g. v0.2.0
git push origin v<version>
```

Then on GitHub:

1. Go to **Releases → Draft a new release**
2. Pick the tag you just pushed (`v0.2.0`)
3. Upload the artifact files from `uploader/out/make/`:
   - `hots-replay-uploader-<version> Setup.exe` (Windows)
   - `HoTS Replay Uploader-<version>-arm64.dmg` (macOS, Intel users need an `x64` build too)
4. Write release notes, publish.

### 4. Automate with Electron Forge publisher (optional)

Install the GitHub publisher once:

```bash
cd uploader
npm install --save-dev @electron-forge/publisher-github
```

Add to `forge.config.js`:

```js
publishers: [
  {
    name: '@electron-forge/publisher-github',
    config: {
      repository: { owner: 'dmackerman', name: 'hots-record' },
      prerelease: false,
      draft: true,   // creates a draft — review before publishing
    },
  },
],
```

Then publish in one command (requires a `GITHUB_TOKEN` env var with `repo` scope):

```bash
GITHUB_TOKEN=ghp_... npm run publish
```

This builds, uploads all artifacts, and creates a draft release automatically.

#### Getting a GitHub token

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Scope: select the repo, grant **Contents: Read and write** (to create releases + upload assets)
3. Store it: `export GITHUB_TOKEN=ghp_...` in your shell profile, or use a `.env` file (gitignored)

### 5. Tag and trigger a release

Bump the version in `uploader/package.json`, commit, then:

```bash
# Tag the current commit and push — this triggers the uploader-release.yml workflow
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions will build on macOS and Windows in parallel and attach the artifacts to a **draft release**. Review it at `https://github.com/dmackerman/hots-record/releases` and click Publish when ready.