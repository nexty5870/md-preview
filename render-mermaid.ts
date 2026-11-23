/**
 * Called by the Herdr mod: node render-mermaid.ts <in.mmd> <out.png> <bg> <fg> [accent] [maxWidth]
 * Writes <out.png> and <out>.json ({ width, height } in logical px), or <out>.err on failure.
 */
import * as fs from "node:fs";
import { png } from "./mermaid.ts";

const [input, output, bg, fg, accent, maxWidth] = process.argv.slice(2);
const meta = output.replace(/\.png$/, ".json");
const err = output.replace(/\.png$/, ".err");
try {
	const r = png(fs.readFileSync(input, "utf8"), bg, fg, accent || undefined, Number(maxWidth) || 0);
	fs.writeFileSync(`${output}.tmp`, r.png);
	fs.renameSync(`${output}.tmp`, output);
	fs.writeFileSync(meta, JSON.stringify({ width: r.width, height: r.height }));
	fs.rmSync(err, { force: true });
} catch (error) {
	fs.writeFileSync(err, (error as Error).message ?? String(error));
	process.exitCode = 1;
}
