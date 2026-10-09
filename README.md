# NePad

A desktop day-planner widget for Windows: tasks, journal, quick notes,
reminders, a Bikram Sambat (Nepali) calendar, and a few audit-focused
utilities (PAN lookup, TDS/VAT return extractors, IRD TDS downloader), all in
a frameless panel that slides in from the screen edge.

Built with Tauri 2 (Rust) + Vite/TypeScript. There is no NePad backend and no
telemetry — your planner data, notes and settings never leave your machine.
The tools that look things up do talk to the IRD's own public website
(`ird.gov.np` / `taxpayerportal.ird.gov.np`) and nowhere else.

## Shortcut

> ## **Win (⊞) + \\**
>
> Press this anywhere, anytime, to open or close NePad.

## Features

1. TDS return extraction (straight into Excel)
2. PAN bulk search
3. VAT return extraction
4. IRD TDS downloader (see the note below)
5. BS Calendar / date conversion
6. Daily journal
7. Stopwatch, timer, and reminders
8. More will be added as per relevancy...

## IRD TDS downloader

Opens the IRD taxpayer portal in its own window so you can log in yourself,
captcha included — NePad never sees, automates or stores your credentials.
Once you are logged in, enter a PAN and a Bikram Sambat date range to list
that taxpayer's submitted TDS returns and save the ones you pick to
`Downloads\IRD Downloads`.

**If a return is refused:** on some networks the portal turns down a
download now and then. NePad retries each refused return automatically; if
one still shows "Portal refused this return", try it again a little later or
from another network.

## Windows Defender false positive

The installer is unsigned (no code-signing cert yet), and Defender's local
ML heuristic may flag it as `Trojan:Win32/Bearfoos.A!ml` on install. This is
a false positive — VirusTotal shows 0/70 detections, including Microsoft's
own cloud engine. The flag is triggered by a benign combination of behaviors
(autostart entry, background tray process, self-updater) that resemble
malware heuristics. If it happens, restore the file from quarantine and add
an exclusion for `%LOCALAPPDATA%\NePad`, or build from source instead.

## Requirements

- Node.js
- Rust + the Tauri prerequisites for Windows (MSVC build tools: VS Build
  Tools 2022 or the Visual Studio C++ workload)

## Development

```
npm install
npm run tauri dev
```

`run_dev.bat` is a convenience launcher that calls into a VS Developer
environment first. See the comments in that file if your VS Build Tools
install isn't at the default location.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

