/**
 * The in-Pi reader: a full-screen overlay that renders a Markdown file with Pi's own
 * Markdown component and theme, scrolls, and reloads when the file changes.
 * Used outside the Herdr app (Herdr TUI, plain terminals) or with /md --here.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";

const MAX_COLS = 100;
const POLL_MS = 800;

export class MarkdownReader implements Component {
	private md: Markdown;
	private text = "";
	private mtime = 0;
	private top = 0;
	private lines: string[] = [];
	private linesWidth = -1;
	private timer: NodeJS.Timeout;
	private flashAt = 0;

	constructor(
		private tui: TUI,
		private theme: Theme,
		private file: string,
		private label: string,
		private done: () => void,
	) {
		this.md = new Markdown("", 0, 0, getMarkdownTheme());
		this.load();
		this.timer = setInterval(() => {
			if (this.load()) {
				this.flashAt = Date.now();
				setTimeout(() => this.tui.requestRender(), 3_100);
				this.tui.requestRender();
			}
		}, POLL_MS);
	}

	/** Re-read the file if it changed. Returns true when the text changed. */
	private load(): boolean {
		let st: fs.Stats;
		try {
			st = fs.statSync(this.file);
		} catch {
			if (this.text !== "\0missing") {
				this.text = "\0missing";
				this.md.setText(`*File not found:* \`${this.file}\``);
				this.invalidate();
				return true;
			}
			return false;
		}
		if (st.mtimeMs === this.mtime) return false;
		this.mtime = st.mtimeMs;
		const text = fs.readFileSync(this.file, "utf8");
		if (text === this.text) return false;
		this.text = text;
		this.md.setText(text.replace(/^---\n[\s\S]*?\n---\n?/, ""));
		this.invalidate();
		return true;
	}

	private rows(): number {
		return Math.max(6, this.tui.terminal.rows ?? 24);
	}

	private page(): number {
		return Math.max(1, this.rows() - 4);
	}

	private maxTop(): number {
		return Math.max(0, this.lines.length - this.page());
	}

	handleInput(data: string): void {
		const before = this.top;
		if (matchesKey(data, "escape") || data === "q") {
			clearInterval(this.timer);
			this.done();
			return;
		}
		if (matchesKey(data, "up") || data === "k") this.top -= 1;
		else if (matchesKey(data, "down") || data === "j") this.top += 1;
		else if (matchesKey(data, "pageUp") || data === "b" || data === "u") this.top -= this.page();
		else if (matchesKey(data, "pageDown") || data === " " || data === "d") this.top += this.page();
		else if (matchesKey(data, "home") || data === "g") this.top = 0;
		else if (matchesKey(data, "end") || data === "G") this.top = this.maxTop();
		else return;
		this.top = Math.max(0, Math.min(this.maxTop(), this.top));
		if (this.top !== before) this.tui.requestRender();
	}

	invalidate(): void {
		this.linesWidth = -1;
		this.md.invalidate();
	}

	render(width: number): string[] {
		const th = this.theme;
		const inner = Math.max(20, width - 2);
		const col = Math.min(MAX_COLS, inner - 4);
		const gutter = Math.floor((inner - col) / 2);
		if (this.linesWidth !== col) {
			this.lines = this.md.render(col);
			this.linesWidth = col;
			this.top = Math.min(this.top, this.maxTop());
		}
		const border = (s: string) => th.fg("border", s);
		const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - visibleWidth(s)));

		const out: string[] = [];
		const name = path.basename(this.file);
		const title = ` ${th.bold(th.fg("accent", name))} ${th.fg("dim", path.dirname(this.label) === "." ? "" : path.dirname(this.label))} `;
		const tw = visibleWidth(title);
		out.push(border("╭─") + truncateToWidth(title, inner - 2) + border("─".repeat(Math.max(0, inner - 1 - tw)) + "╮"));

		const page = this.page();
		const body = this.lines.slice(this.top, this.top + page);
		out.push(border("│") + " ".repeat(inner) + border("│"));
		for (let i = 0; i < page; i++) {
			const line = body[i] ?? "";
			out.push(border("│") + pad(" ".repeat(gutter) + truncateToWidth(line, col), inner) + border("│"));
		}
		out.push(border("│") + " ".repeat(inner) + border("│"));

		const total = this.lines.length;
		const pct = total <= page ? "all" : `${Math.round(((this.top + page) / total) * 100)}%`;
		const left = ` ${th.fg("dim", "↑↓/jk scroll · space/b page · g/G top/end · q close")} `;
		const right = ` ${Date.now() - this.flashAt < 3_000 ? th.fg("success", "● updated") + "  " : ""}${th.fg("muted", `${Math.min(total, this.top + 1)}–${Math.min(total, this.top + page)} of ${total} · ${pct}`)} `;
		const fill = Math.max(0, inner - visibleWidth(left) - visibleWidth(right));
		out.push(border("╰") + truncateToWidth(left + border("─".repeat(fill)) + right, inner) + border("╯"));
		return out.map((l) => truncateToWidth(l, width));
	}

	dispose(): void {
		clearInterval(this.timer);
	}
}
