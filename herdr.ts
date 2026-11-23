/**
 * Herdr app plumbing: install the md-viewer mod, open it in a pane beside this Pi,
 * and point it at a file through a small control file the mod re-reads.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const MOD_NAME = "md-viewer";
const MARKER = ".pi-md-viewer";
const MOD_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "herdr-mod");
/** No heartbeat for this long: the pane was closed. The mod beats every 5 s. */
const GONE_MS = 15_000;

export const isHerdrApp = () => !!process.env.HC_TERMINAL_ID;
export const appHome = () => process.env.HERDR_APP_HOME || path.join(os.homedir(), ".config", "herdr-app");
const appBin = () => process.env.HERDR_APP_BIN || "herdr-app";
const modDir = () => path.join(appHome(), "mods", MOD_NAME);

export type Control = { file: string; follow: boolean; recent: string[] };

async function appDo<T>(pi: ExtensionAPI, command: string, args: Record<string, unknown>): Promise<T> {
	const res = await pi.exec(appBin(), ["do", command, JSON.stringify(args)], { timeout: 10_000 });
	const out = res.stdout.trim();
	let parsed: any;
	try {
		parsed = out ? JSON.parse(out) : undefined;
	} catch {}
	const err = parsed?.error;
	if (res.code !== 0 || err) throw new Error(`${command}: ${err ?? (res.stderr.trim() || out || `exit ${res.code}`)}`);
	return parsed as T;
}

/** The pane showing this Pi's terminal in the app. */
async function myPane(pi: ExtensionAPI): Promise<string> {
	const terminal = process.env.HC_TERMINAL_ID;
	const res = await pi.exec(appBin(), ["ls"], { timeout: 10_000 });
	if (res.code !== 0) throw new Error(`herdr-app ls: ${res.stderr.trim() || `exit ${res.code}`}`);
	const ls = JSON.parse(res.stdout) as { spaces: { tabs: { terminals: { terminal: string; pane: string }[] }[] }[] };
	const pane = ls.spaces.flatMap((s) => s.tabs.flatMap((t) => t.terminals)).find((t) => t.terminal === terminal)?.pane;
	if (!pane) throw new Error(`The Herdr app shows terminal ${terminal} in no pane. Is the window open?`);
	return pane;
}

/** Copy the mod into mods/md-viewer when missing or out of date. Never overwrites someone else's mod. */
export function installMod(): void {
	const dest = modDir();
	if (fs.existsSync(dest) && !fs.existsSync(path.join(dest, MARKER))) {
		throw new Error(`${dest} is another mod; refusing to overwrite it`);
	}
	fs.mkdirSync(path.join(dest, ".alive"), { recursive: true });
	fs.mkdirSync(path.join(dest, ".state"), { recursive: true });
	const marker = path.join(dest, MARKER);
	if (!fs.existsSync(marker)) fs.writeFileSync(marker, "Installed by the pi-md-viewer Pi extension. Safe to delete with this folder.\n");
	for (const f of fs.readdirSync(MOD_SOURCE)) {
		const src = fs.readFileSync(path.join(MOD_SOURCE, f));
		const target = path.join(dest, f);
		if (fs.existsSync(target) && fs.readFileSync(target).equals(src)) continue;
		fs.writeFileSync(target, src);
	}
}

const controlFile = (id: string) => path.join(modDir(), ".state", `${id}.json`);
const beatFile = (id: string) => path.join(modDir(), ".alive", `${id}.txt`);

export function viewerOpen(id: string): boolean {
	try {
		return Date.now() - Number(fs.readFileSync(beatFile(id), "utf8").trim()) < GONE_MS;
	} catch {
		return false;
	}
}

export function writeControl(id: string, c: Control): void {
	const file = controlFile(id);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(`${file}.tmp`, JSON.stringify(c, null, 2));
	fs.renameSync(`${file}.tmp`, file);
}

/** Show `c.file` in the viewer pane for `id`: reuse an open one, else split one to the right of this Pi. */
export async function showInApp(pi: ExtensionAPI, id: string, c: Control, below = false): Promise<"reused" | "opened"> {
	installMod();
	writeControl(id, c);
	if (viewerOpen(id)) return "reused";
	const pane = await myPane(pi);
	// A just-copied mod may not be loaded yet (the app hot-reloads mods/): retry briefly.
	const until = Date.now() + 8_000;
	for (;;) {
		try {
			await appDo(pi, "pane.split", { direction: below ? "down" : "right", pane, mod: MOD_NAME, props: { control: controlFile(id), id } });
			// Count it as open right away, so a second /md before its first beat doesn't split again.
			fs.writeFileSync(beatFile(id), String(Date.now()));
			return "opened";
		} catch (error) {
			if (!/no mod/i.test(String((error as Error)?.message ?? error)) || Date.now() > until) throw error;
			await new Promise((r) => setTimeout(r, 400));
		}
	}
}
