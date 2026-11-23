# pi-md-viewer

`/md` for Pi: read the Markdown files your agent writes in a proper viewer.

- **In the Herdr app**, the file opens in a native pane beside Pi: proportional type, tables, code blocks, front matter as a card, an outline you can click, recent files, A−/A+ text size. It reloads live as the file changes, and it **follows** the agent: each `.md` it writes or edits shows up in the pane.
- **Anywhere else** (Herdr TUI, plain terminal) or with `--here`: a full-screen reader inside Pi with Pi's own Markdown theme. Keys: ↑↓ or j/k, space/b, g/G, q or Esc.

```
/md                 pick a file (this session's .md files first, then the project's newest)
/md <file>          open that file
/md --here [file]   read inside Pi instead of a Herdr pane
/md follow on|off   the pane jumps to each .md the agent writes (default on)
/md --help
```

Pi's footer shows the latest `.md` the agent wrote (`📄 plan.md · /md to read`).

## Install

Symlink or copy this folder to `~/.pi/agent/extensions/md-viewer`. The first `/md` in the Herdr app copies `herdr-mod/` to `~/.config/herdr-app/mods/md-viewer` (it never overwrites a mod it didn't install).

Optional keys for the pane (`~/.config/herdr-app/keys.json`):

```json
"mod:md-viewer": { "j": "md-viewer.next", "k": "md-viewer.prev", "g": "md-viewer.top" }
```

## Files

- `index.ts`: the `/md` command, tracking of `.md` writes, follow mode
- `herdr.ts`: installs the mod, opens the pane beside this Pi, the control file it re-reads
- `overlay.ts`: the in-Pi full-screen reader
- `herdr-mod/`: the Herdr app mod (gpui-kit)
