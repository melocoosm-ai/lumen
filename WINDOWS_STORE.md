# Publishing Lumen to the Microsoft Store

Lumen ships to the Store as an **MSIX/AppX package** built by
[electron-builder](https://www.electron.build/). Microsoft signs Store packages itself, so you do
**not** need to buy a code-signing certificate. AppX packaging needs Windows, so the
[Windows build workflow](.github/workflows/windows.yml) builds it on a GitHub-hosted Windows runner
on every push.

## 1. One-time account setup

1. Sign up at **[Partner Center](https://partner.microsoft.com/dashboard/registration)** as an
   individual developer (free for individuals; company accounts have a one-time fee and need
   business verification).
2. In Partner Center → **Apps and games → New product → MSIX or PWA app**, reserve a name.
   "Lumen" may already be taken; good fallbacks are "Lumen Browser" or "Lumen Web Browser".
   If you change the name, also change `build.appx.displayName` in `package.json`.

## 2. Connect the package to your Store listing

Open the product → **Product management → Product identity**. Copy three values into the GitHub repo
under **Settings → Secrets and variables → Actions → Variables**:

| Partner Center field | Repository variable | Example |
| --- | --- | --- |
| Package/Identity/Name | `MS_STORE_IDENTITY_NAME` | `12345Melocoosm.LumenBrowser` |
| Package/Identity/Publisher | `MS_STORE_PUBLISHER` | `CN=1A2B3C4D-5E6F-...` |
| Package/Properties/PublisherDisplayName | `MS_STORE_PUBLISHER_NAME` | `melocoosm-ai` |

Without these, the workflow builds with a placeholder identity (`Lumen.Dev` / `CN=Lumen Dev`). That
package is fine for testing, but the Store rejects it.

## 3. Build

Push to `main` (or run **Actions → Windows build → Run workflow**). When it finishes, download the
**lumen-windows** artifact. It contains:

- `Lumen-<version>-x64.appx` and `Lumen-<version>-arm64.appx`: upload both to the Store
- `Lumen-Setup-<version>-<arch>.exe`: a regular installer for direct download (unsigned, so Windows
  SmartScreen will warn until it is code-signed)

The **Smoke test (Windows)** job runs the real app on Windows and checks the window controls,
navigation and tabs. Its screenshots are attached as an artifact.

## 4. Fill in the submission

| Section | What to enter |
| --- | --- |
| **Pricing and availability** | Free; all markets |
| **Properties** | Category: *Productivity* (or *Utilities & tools*). Privacy policy URL: `https://github.com/melocoosm-ai/lumen/blob/main/PRIVACY.md` |
| **Age ratings** | Complete the IARC questionnaire and answer **Yes** to unrestricted internet access. |
| **Packages** | Upload both `.appx` files from step 3. |
| **Store listing** | Description and features (see below), at least 1 screenshot (1366×768 or larger, 4 recommended), and a 300×300 app tile icon (use `build/icon.png`, resized). |
| **Submission options → restricted capabilities** | The package declares `runFullTrust`, which every Electron desktop app needs. Justification to paste: *"Lumen is a desktop web browser built with Electron. It runs as a full-trust desktop process to host the Chromium web engine and its sandboxed renderer processes."* |

**Short description:** A fast, private web browser with tabs. No accounts, no tracking.

**Description:**

> Lumen is a clean, fast web browser that keeps your browsing yours.
>
> • Tabs: open, switch and close them with the mouse or keyboard (Ctrl+T, Ctrl+W, Ctrl+1–9)
> • Smart address bar: type a website or just search
> • Each tab runs in its own sandboxed process
> • Light and dark themes that follow Windows
> • No accounts, no ads, no analytics. Searches go to DuckDuckGo.

Certification usually takes 1–3 business days.

## Updating later

Bump `"version"` in `package.json` (the Store requires each upload to have a higher version), push,
download the new artifact and create a new submission with the new `.appx` files.

## Building locally on Windows

```bash
npm ci
npm run dist:win     # writes dist/*.appx and dist/*-Setup-*.exe
```

To build with your Store identity locally, append
`-c.appx.identityName=... -c.appx.publisher="CN=..."` to the electron-builder command.
