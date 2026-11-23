# pi-md-viewer

`/md` for Pi: read the Markdown files your agent writes in a proper viewer.

- **In the Herdr app, nothing to type.** When the agent writes a `.md`, a native reading pane opens beside Pi by itself (the keyboard stays in Pi) and follows each new `.md`, reloading live. Proportional type, tables, code blocks, front matter as a card, a clickable outline, recent files, A−/A+. Close the pane and it stays closed until you ask again (`/md` or alt+m).
- **Anywhere else** (Herdr TUI, plain terminal): the footer names the latest `.md` and **alt+m** opens it in a full-screen reader inside Pi. Keys: ↑↓ or j/k, space/b, g/G, q or Esc. `/md --here` forces this reader in the Herdr app too.
- **Mermaid**: ```mermaid blocks render as diagrams in the pane (click one for full size) and as box drawings in the Pi reader. Rendered locally with [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) and resvg: no browser, no network. Wide left-to-right flowcharts are laid out top-to-bottom when that fits the pane better.

```
/md                 pick a file (this session's .md files first, then the project's newest)
/md <file>          open that file
/md --here [file]   read inside Pi instead of a Herdr pane
/md auto on|off     open the pane by itself when the agent writes a .md (default on)
/md follow on|off   the open pane jumps to each new .md (default on)
/md --help
```

Pi's footer shows the latest `.md` the agent wrote (`📄 plan.md · /md to read`).

## Install

Symlink or copy this folder to `~/.pi/agent/extensions/md-viewer`, then `npm install` in it (beautiful-mermaid, @resvg/resvg-js). The first `/md` in the Herdr app copies `herdr-mod/` to `~/.config/herdr-app/mods/md-viewer` (it never overwrites a mod it didn't install).

Optional keys for the pane (`~/.config/herdr-app/keys.json`):

```json
"mod:md-viewer": { "j": "md-viewer.next", "k": "md-viewer.prev", "g": "md-viewer.top" }
```

## Files

- `index.ts`: the `/md` command, tracking of `.md` writes, follow mode
- `herdr.ts`: installs the mod, opens the pane beside this Pi, the control file it re-reads
- `overlay.ts`: the in-Pi full-screen reader
- `mermaid.ts`, `render-mermaid.ts`: diagrams (text drawings for Pi, PNGs for the pane, cached in the mod folder)
- `herdr-mod/`: the Herdr app mod (gpui-kit)
