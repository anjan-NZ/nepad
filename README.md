# NePad

A desktop day-planner widget for Windows: tasks, journal, quick notes,
reminders, a Bikram Sambat (Nepali) calendar, and a few audit-focused
utilities (PAN lookup, TDS/VAT return extractors, IRD TDS/VAT downloader), all in
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
4. IRD TDS and VAT downloader, plus Paid Voucher List and Annex 10 export to Excel (see the note below)
5. BS Calendar / date conversion, with the month's holidays listed and the next one marked
6. Daily journal
7. Stopwatch, timer, and reminders
8. Frosted glass look that follows your Windows light/dark mode and accent colour
9. More will be added as per relevancy...

## IRD TDS and VAT downloader

Opens the IRD taxpayer portal in its own window so you can log in yourself,
captcha included — NePad never sees, automates or stores your password. It only
reads the PAN you type there, to pre-fill its own PAN box.
Once you are logged in, pick TDS or VAT, enter a PAN and choose a fiscal
year (or a span of years, or a custom range) to list that taxpayer's
submitted returns and save the ones you pick to `Downloads\IRD Downloads`.
VAT files are named like `Bhadra_2083_VAT_<PAN>.pdf`.

You can also pick **Paid Voucher List** or **Annex 10 vouchers** as the type.
These are saved as Excel files, not PDFs. Annex 10 gives one file per fiscal year.

Every client gets its own folder, sorted by type and fiscal year:

```
Downloads\IRD Downloads\
  ABC Traders Pvt Ltd (301234567)\
    TDS\2081-82\
    VAT\2081-82\
    Vouchers\2081-82\
    Annex10\2081-82\
```

The name comes from the PAN lookup. If the lookup is down that day the files
still go into the client's existing folder since it's found by the PAN in
brackets. For a new client the folder is just the PAN for now and it gets
renamed once the lookup works again, so one client never ends up in two folders.

## Look

NePad uses a frosted glass panel that follows your Windows light or dark mode
and your accent colour. You can change how strong the glass is in
**Settings → Glass** (Clear, Balanced or Frosted, default Frosted).

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

