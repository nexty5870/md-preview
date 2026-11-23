/**
 * Mermaid rendering with beautiful-mermaid (no browser, no network):
 *   - ascii(): for the in-Pi reader
 *   - png():   for the Herdr pane. beautiful-mermaid's SVG themes itself with CSS
 *              variables and color-mix(), which SVG rasterizers don't support, so the
 *              colors are resolved here first, then resvg draws it at 2x.
 */
import { Resvg } from "@resvg/resvg-js";
import { renderMermaidASCII, renderMermaidSVG } from "beautiful-mermaid";

const MERMAID_FENCE = /^(\s*)(```|~~~)\s*mermaid\s*\n([\s\S]*?)\n\s*\2\s*$/gm;
const LR = /^(\s*(?:flowchart|graph)\s+)(LR|RL)\b/m;

const widest = (s: string) => Math.max(0, ...s.split("\n").map((l) => [...l].length));

/** Plain (uncolored) text drawing. A left-to-right flowchart too wide for `width` is drawn top-to-bottom. */
export function ascii(code: string, width = 0): string {
	const draw = (c: string) => renderMermaidASCII(c, { colorMode: "none", paddingX: 3 } as any).replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, "");
	const art = draw(code);
	if (width && widest(art) > width && LR.test(code)) {
		const td = draw(code.replace(LR, "$1TD"));
		if (widest(td) < widest(art)) return td;
	}
	return art;
}

/** Replace ```mermaid blocks with their text drawing (as a plain code block). */
export function asciiBlocks(markdown: string, width = 0): string {
	return markdown.replace(MERMAID_FENCE, (_m, indent: string, _fence, code: string) => {
		let art: string;
		try {
			art = ascii(code, Math.max(20, width - 4));
		} catch (error) {
			art = `mermaid: ${(error as Error).message}\n\n${code}`;
		}
		return `${indent}\`\`\`\n${art}\n${indent}\`\`\``;
	});
}

const hex = (c: string) => {
	const m = /^#?([0-9a-f]{6})/i.exec(c.trim());
	if (!m) throw new Error(`not a #rrggbb color: ${c}`);
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
/** color-mix(in srgb, fg P%, bg) */
const mix = (fg: string, bg: string, p: number) => {
	const a = hex(fg);
	const b = hex(bg);
	return toHex(a.map((v, i) => v * p + b[i] * (1 - p)));
};

/** Resolve every var()/color-mix() in beautiful-mermaid's SVG to plain colors. */
export function flatten(svg: string, bg: string, fg: string, accent?: string): string {
	const vars: Record<string, string> = { "--bg": bg, "--fg": fg };
	// Derived colors, from the <style> block: --_x: var(--y, color-mix(in srgb, var(--fg) N%, var(--bg)))
	for (const m of svg.matchAll(/(--_[\w-]+):\s*([^;]+);/g)) {
		const [, name, expr] = m;
		const pct = /color-mix\(in srgb, var\(--fg\) (\d+)%, var\(--bg\)\)/.exec(expr);
		if (name === "--_arrow" && accent) vars[name] = accent;
		else if (pct) vars[name] = mix(fg, bg, Number(pct[1]) / 100);
		else if (/^var\(--fg\)$/.test(expr.trim())) vars[name] = fg;
		else if (/^var\(--bg\)$/.test(expr.trim())) vars[name] = bg;
	}
	let out = svg
		.replace(/<style>[\s\S]*?<\/style>/, "")
		.replace(/style="[^"]*--bg:[^"]*"/, `style="background:${bg}"`)
		.replace(/color-mix\(in srgb, var\(--fg\) (\d+)%, var\(--bg\)\)/g, (_m, p) => mix(fg, bg, Number(p) / 100))
		.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_m, name, fallback) => vars[name] ?? fallback ?? fg);
	// Text font: the style block named Inter (from Google Fonts); use local sans fonts instead.
	out = out.replace(/<svg /, `<svg font-family="Inter, Helvetica Neue, Helvetica, Arial, sans-serif" `);
	return out;
}

export type Png = { png: Buffer; width: number; height: number };

const size = (svg: string) => {
	const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
	return { width: vb ? Number(vb[1]) : 600, height: vb ? Number(vb[2]) : 400 };
};

/**
 * Draw a diagram for a column `maxWidth` px wide. A left-to-right flowchart that would
 * have to shrink a lot is laid out top-to-bottom instead, when that reads better.
 */
export function png(code: string, bg: string, fg: string, accent?: string, maxWidth = 0, scale = 2): Png {
	const opts = { bg, fg, padding: 16 };
	let svg = flatten(renderMermaidSVG(code, opts), bg, fg, accent);
	let { width, height } = size(svg);
	if (maxWidth && width > maxWidth / 0.85 && LR.test(code)) {
		const td = flatten(renderMermaidSVG(code.replace(LR, "$1TD"), opts), bg, fg, accent);
		const s = size(td);
		if (Math.min(1, maxWidth / s.width) > Math.min(1, maxWidth / width)) {
			svg = td;
			({ width, height } = s);
		}
	}
	const r = new Resvg(svg, {
		fitTo: { mode: "zoom", value: scale },
		font: { loadSystemFonts: true, defaultFontFamily: "Helvetica Neue" },
		background: bg,
	});
	return { png: r.render().asPng(), width, height };
}
