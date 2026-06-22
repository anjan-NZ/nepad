# NePad

A desktop day-planner widget for Windows: tasks, journal, quick notes,
reminders, a Bikram Sambat (Nepali) calendar, and a few audit-focused
utilities (PAN lookup, TDS/VAT return extractors), all in a frameless panel
that slides in from the screen edge.

Built with Tauri 2 (Rust) + Vite/TypeScript. All data stays local: no
backend, no telemetry.

## Shortcut

> ## **Win (⊞) + \\**
>
> Press this anywhere, anytime, to open or close NePad.

## Features

1. TDS return extraction (straight into Excel)
2. PAN bulk search
3. VAT return extraction
4. BS Calendar / date conversion
5. Daily journal
6. Stopwatch, timer, and reminders
7. More will be added as per relevancy...

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

