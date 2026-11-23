/**
 * /md — read Markdown comfortably while Pi works.
 *
 *   In the Herdr app: a native reading pane beside this Pi (proportional type, outline,
 *   live reload). It follows each .md file the agent writes, unless you turn that off.
 *   Elsewhere (Herdr TUI, any terminal) or with --here: a full-screen reader inside Pi.
 *
 *   /md                 pick a file (this session's .md files first, newest on top)
 *   /md <file>          open that file
 *   /md --here [file]   read inside Pi instead of a Herdr pane
 *   /md follow on|off   jump to each .md the agent writes (default on)
 *   /md --help
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { ago, expandPath, isMarkdown, recentMarkdown, shown } from "./files.ts";
import { isHerdrApp, showInApp, viewerOpen, writeControl } from "./herdr.ts";
import { MarkdownReader } from "./overlay.ts";

const STATUS = "md-viewer";

const HELP = `/md — read Markdown files in a viewer

  /md                 pick a file: this session's .md files first, then the project's newest
  /md <file>          open that file
  /md --here [file]   read inside Pi (full-screen) instead of a Herdr pane
  /md follow on|off   viewer jumps to each .md the agent writes (default: on)
  /md --help          this guide

In the Herdr app the file opens in a native pane beside this Pi and reloads as it changes.
Elsewhere it opens full-screen in Pi: ↑↓ or j/k scroll, space/b page, g/G top/end, q or Esc close.`;

export default function (pi: ExtensionAPI): void {
	/** .md files the agent wrote or edited this session, newest first. */
	let written: string[] = [];
	let follow = true;
	let current: string | undefined;
	let viewerId = "pi";

	const recentList = () => written.slice(0, 20);

	const hint = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		const last = written[0];
		if (!last) return ctx.ui.setStatus(STATUS, undefined);
		const open = isHerdrApp() && viewerOpen(viewerId);
		const text = open && follow ? `📄 ${path.basename(last)} · in viewer` : `📄 ${path.basename(last)} · /md to read`;
		ctx.ui.setStatus(STATUS, ctx.ui.theme.fg("dim", text));
	};

	pi.on("session_start", (_e, ctx) => {
		written = [];
		current = undefined;
		const sf = ctx.sessionManager.getSessionFile();
		viewerId = sf ? path.basename(sf).replace(/\.jsonl$/, "").slice(-12) : `pi-${process.pid}`;
		hint(ctx);
	});

	pi.on("tool_result", (event, ctx) => {
		if (event.isError) return;
		if (event.toolName !== "write" && event.toolName !== "edit") return;
		const raw = (event.input as { path?: string; file_path?: string })?.path ?? (event.input as { file_path?: string })?.file_path;
		if (!raw || !isMarkdown(raw)) return;
		const file = expandPath(raw, ctx.cwd);
		written = [file, ...written.filter((f) => f !== file)];
		// The viewer is open and following: show the new file there now.
		if (isHerdrApp() && follow && viewerOpen(viewerId)) {
			current = file;
			try {
				writeControl(viewerId, { file, follow, recent: recentList() });
			} catch {}
		}
		hint(ctx);
	});

	const open = async (file: string, ctx: ExtensionCommandContext, here: boolean) => {
		if (!fs.existsSync(file)) {
			ctx.ui.notify(`No such file: ${shown(file, ctx.cwd)}`, "error");
			return;
		}
		if (!written.includes(file)) written = [...written, file];
		current = file;
		if (!here && isHerdrApp()) {
			try {
				const how = await showInApp(pi, viewerId, { file, follow, recent: [file, ...recentList().filter((f) => f !== file)] });
				ctx.ui.notify(`${how === "opened" ? "Opened" : "Showing"} ${shown(file, ctx.cwd)} in the viewer${follow ? " (following new .md files)" : ""}`, "info");
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

	const pick = async (ctx: ExtensionCommandContext): Promise<string | undefined> => {
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

	pi.registerCommand("md", {
		description: "Read a Markdown file in a viewer (Herdr pane, or full-screen in Pi)",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const items: AutocompleteItem[] = [
				{ value: "--here ", label: "--here", description: "read inside Pi" },
				{ value: "follow on", label: "follow on", description: "jump to each .md the agent writes" },
				{ value: "follow off", label: "follow off", description: "stay on the current file" },
				...written.slice(0, 10).map((f) => ({ value: f, label: path.basename(f), description: "written this session" })),
			];
			const hits = items.filter((i) => i.value.startsWith(prefix) || i.label.startsWith(prefix));
			return hits.length ? hits : null;
		},
		handler: async (args, ctx) => {
			let rest = args.trim();
			if (rest === "--help" || rest === "-h" || rest === "help") {
				ctx.ui.notify(HELP, "info");
				return;
			}
			const f = /^follow(?:\s+(on|off))?$/.exec(rest);
			if (f) {
				follow = f[1] ? f[1] === "on" : !follow;
				if (current && isHerdrApp() && viewerOpen(viewerId)) writeControl(viewerId, { file: current, follow, recent: recentList() });
				ctx.ui.notify(`Follow ${follow ? "on: the viewer jumps to each .md the agent writes" : "off: the viewer stays on its file"}`, "info");
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
