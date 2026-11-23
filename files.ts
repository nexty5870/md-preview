/** Finding Markdown files: the ones this session wrote, and recent ones in the project. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const MD_RE = /\.(md|markdown|mdx)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", ".cache", "vendor", "target", ".venv", "venv"]);

export function expandPath(p: string, cwd: string): string {
	let s = p.trim().replace(/^["']|["']$/g, "");
	if (s.startsWith("@")) s = s.slice(1);
	if (s === "~" || s.startsWith("~/")) s = path.join(os.homedir(), s.slice(1));
	return path.resolve(cwd, s);
}

export function isMarkdown(p: string): boolean {
	return MD_RE.test(p);
}

/** Markdown files under `root`, newest first. Shallow-ish walk (depth 4, capped) so it stays instant. */
export function recentMarkdown(root: string, limit = 40): { file: string; mtime: number }[] {
	const found: { file: string; mtime: number }[] = [];
	let visited = 0;
	const walk = (dir: string, depth: number) => {
		if (depth > 4 || visited > 4_000) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			visited++;
			if (e.name.startsWith(".") && e.name !== ".pi") continue;
			const full = path.join(dir, e.name);
			if (e.isDirectory()) {
				if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1);
			} else if (e.isFile() && isMarkdown(e.name)) {
				try {
					found.push({ file: full, mtime: fs.statSync(full).mtimeMs });
				} catch {}
			}
		}
	};
	walk(root, 0);
	return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

export function ago(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function shown(file: string, cwd: string): string {
	const rel = path.relative(cwd, file);
	if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
	const home = os.homedir();
	return file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file;
}
