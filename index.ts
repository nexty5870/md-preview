/**
 * /md — read Markdown comfortably while Pi works.
 *
 *   In the Herdr app: the agent writes a .md and a native reading pane opens beside Pi
 *   on its own (keyboard stays in Pi). It keeps following each new .md and reloads live.
 *   Close it and it stays closed until you ask again (/md or alt+m).
 *   Elsewhere (Herdr TUI, any terminal): the footer names the latest .md; alt+m opens it
 *   in a full-screen reader inside Pi.
 *   Mermaid blocks render as diagrams in the pane, and as text drawings in the reader.
 *
 *   /md                 pick a file (this session's .md files first, newest on top)
 *   /md <file>          open that file
 *   /md --here [file]   read inside Pi instead of a Herdr pane
 *   /md auto on|off     open the pane by itself when the agent writes a .md (default on)
 *   /md follow on|off   the open pane jumps to each new .md (default on)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { ago, expandPath, isMarkdown, recentMarkdown, shown } from "./files.ts";
import { isHerdrApp, showInApp, viewerOpen, writeControl } from "./herdr.ts";
import { MarkdownReader } from "./overlay.ts";

const STATUS = "md-viewer";
const KEY = "alt+m";

const HELP = `/md — read Markdown files in a viewer

  Nothing to type in the Herdr app: when the agent writes a .md, a reading pane opens
  beside Pi by itself and follows each new one. Close it and it stays closed until /md.
  Elsewhere, the footer names the latest .md and ${KEY} opens it full-screen in Pi.

  /md                 pick a file: this session's .md files first, then the project's newest
  /md <file>          open that file
  /md --here [file]   read inside Pi (full-screen) instead of a Herdr pane
  /md auto on|off     open the pane by itself when the agent writes a .md (default: on)
  /md follow on|off   the open pane jumps to each new .md (default: on)
  /md --help          this guide

Mermaid blocks show as diagrams in the pane and as text drawings in Pi.
In Pi: ↑↓ or j/k scroll, space/b page, g/G top/end, q or Esc close.`;

export default function (pi: ExtensionAPI): void {
	/** .md files the agent wrote or edited this session, newest first. */
	let written: string[] = [];
	let follow = true;
	let auto = true;
	/** We opened the pane, then it went away: the person closed it. Don't reopen on our own. */
	let opened = false;
	let dismissed = false;
	let opening: Promise<unknown> | undefined;
	let current: string | undefined;
	let viewerId = "pi";

	const recentList = () => written.slice(0, 20);

	const hint = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		const last = written[0];
		if (!last) return ctx.ui.setStatus(STATUS, undefined);
		const name = path.basename(last);
		const inPane = isHerdrApp() && viewerOpen(viewerId) && current === last;
		ctx.ui.setStatus(STATUS, ctx.ui.theme.fg("dim", inPane ? `📄 ${name} · in viewer` : `📄 ${name} · ${KEY} to read`));
	};

	pi.on("session_start", (_e, ctx) => {
		written = [];
		current = undefined;
		opened = dismissed = false;
		const sf = ctx.sessionManager.getSessionFile();
		viewerId = sf ? path.basename(sf).replace(/\.jsonl$/, "").slice(-12) : `pi-${process.pid}`;
		hint(ctx);
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.isError) return;
		if (event.toolName !== "write" && event.toolName !== "edit") return;
		const input = event.input as { path?: string; file_path?: string };
		const raw = input?.path ?? input?.file_path;
		if (!raw || !isMarkdown(raw)) return;
		const file = expandPath(raw, ctx.cwd);
		written = [file, ...written.filter((f) => f !== file)];
		if (isHerdrApp()) {
			const open = viewerOpen(viewerId);
			if (opened && !open) dismissed = true;
			if (open && follow) {
				current = file;
				try {
					writeControl(viewerId, { file, follow, recent: recentList() });
				} catch {}
			} else if (!open && auto && !dismissed && !opening) {
				// First .md of the run: open the pane beside Pi without taking the keyboard.
				current = file;
				opening = showInApp(pi, viewerId, { file, follow, recent: recentList() }, { keepFocus: true })
					.then(() => {
						opened = true;
					})
					.catch(() => undefined)
					.finally(() => {
						opening = undefined;
						hint(ctx);
					});
			}
		}
		hint(ctx);
	});

	const open = async (file: string, ctx: ExtensionContext, here: boolean) => {
		if (!fs.existsSync(file)) {
			ctx.ui.notify(`No such file: ${shown(file, ctx.cwd)}`, "error");
			return;
		}
		if (!written.includes(file)) written = [...written, file];
		current = file;
		if (!here && isHerdrApp()) {
			try {
				dismissed = false;
				const how = await showInApp(pi, viewerId, { file, follow, recent: [file, ...recentList().filter((f) => f !== file)] });
				opened = true;
				ctx.ui.notify(`${how === "opened" ? "Opened" : "Showing"} ${shown(file, ctx.cwd)} in the viewer`, "info");
				hint(ctx);
				return;
			} catch (error) {
				ctx.ui.notify(`Herdr viewer unavailable (${(error as Error).message}); reading here instead.`, "warning");
			}
		}
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/md needs the interactive TUI or the Herdr app.", "error");
			return;
		}
		const label = shown(file, ctx.cwd);
		await ctx.ui.custom<void>((tui, theme, _kb, done) => new MarkdownReader(tui, theme, file, label, () => done()), {
			overlay: true,
			overlayOptions: { width: "100%", maxHeight: "100%", anchor: "center" },
		});
	};

	const pick = async (ctx: ExtensionContext): Promise<string | undefined> => {
		const now = Date.now();
		const seen = new Set<string>();
		const rows: { file: string; label: string }[] = [];
		const add = (file: string, tag: string) => {
			if (seen.has(file) || !fs.existsSync(file)) return;
			seen.add(file);
			let when = "";
			try {
				when = ago(now - fs.statSync(file).mtimeMs);
			} catch {}
			rows.push({ file, label: `${shown(file, ctx.cwd)}  ·  ${tag}${when}` });
		};
		for (const f of written) add(f, "this session · ");
		for (const { file } of recentMarkdown(ctx.cwd)) add(file, "");
		if (rows.length === 0) {
			ctx.ui.notify("No Markdown files here yet. Try /md <file>.", "info");
			return undefined;
		}
		if (rows.length === 1) return rows[0].file;
		const choice = await ctx.ui.select("Read which Markdown file?", rows.slice(0, 30).map((r) => r.label));
		return rows.find((r) => r.label === choice)?.file;
	};

	pi.registerShortcut(KEY, {
		description: "Read the latest Markdown file the agent wrote",
		handler: async (ctx) => {
			const file = written.find((f) => fs.existsSync(f)) ?? (await pick(ctx));
			if (file) await open(file, ctx, false);
		},
	});

	pi.registerCommand("md", {
		description: "Read a Markdown file in a viewer (Herdr pane, or full-screen in Pi)",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const items: AutocompleteItem[] = [
				{ value: "--here ", label: "--here", description: "read inside Pi" },
				{ value: "auto off", label: "auto off", description: "don't open the pane by itself" },
				{ value: "auto on", label: "auto on", description: "open the pane when the agent writes a .md" },
				{ value: "follow off", label: "follow off", description: "the pane stays on its file" },
				{ value: "follow on", label: "follow on", description: "the pane jumps to each new .md" },
				...written.slice(0, 10).map((f) => ({ value: f, label: path.basename(f), description: "written this session" })),
			];
			const hits = items.filter((i) => i.value.startsWith(prefix) || i.label.startsWith(prefix));
			return hits.length ? hits : null;
		},
		handler: async (args, ctx: ExtensionCommandContext) => {
			let rest = args.trim();
			if (rest === "--help" || rest === "-h" || rest === "help") {
				ctx.ui.notify(HELP, "info");
				return;
			}
			const toggle = /^(follow|auto)(?:\s+(on|off))?$/.exec(rest);
			if (toggle) {
				const on = (was: boolean) => (toggle[2] ? toggle[2] === "on" : !was);
				if (toggle[1] === "follow") {
					follow = on(follow);
					if (current && isHerdrApp() && viewerOpen(viewerId)) writeControl(viewerId, { file: current, follow, recent: recentList() });
					ctx.ui.notify(`Follow ${follow ? "on: the pane jumps to each .md the agent writes" : "off: the pane stays on its file"}`, "info");
				} else {
					auto = on(auto);
					if (auto) dismissed = false;
					ctx.ui.notify(`Auto-open ${auto ? "on: the pane opens when the agent writes a .md" : "off: open it with /md or " + KEY}`, "info");
				}
				hint(ctx);
				return;
			}
			let here = false;
			if (/^--here\b/.test(rest)) {
				here = true;
				rest = rest.replace(/^--here\s*/, "");
			}
			const file = rest ? expandPath(rest, ctx.cwd) : await pick(ctx);
			if (!file) return;
			await open(file, ctx, here);
		},
	});
}
