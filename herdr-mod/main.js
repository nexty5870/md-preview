// md-viewer: a reading pane for Markdown files, beside Pi in the Herdr app.
// Props: { file } to show one file, or { control, id } to follow what Pi points it at:
// Pi (the /md command) writes { file, follow, recent } to the control file, and this
// pane re-reads both the control file and the Markdown file, so edits show live.
// It also beats .alive/<id>.txt so Pi knows the pane is still open.
// Installed by the pi-md-viewer extension; edits here are overwritten.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, TextView } from "gpui-base";
import { appHome, checking, exec, nextCommand, props, readTextFile, theme, writeTextFile } from "herdr";

const READ_MS = 700;
const BEAT_MS = 5000;
const SIZES = [13, 14, 15, 16, 17, 18, 20];

function base(file) {
  return file ? file.split("/").pop() : "";
}

function shortDir(file) {
  if (!file) return "";
  const dir = file.split("/").slice(0, -1).join("/");
  const h = dir.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
  return h.length > 60 ? "…" + h.slice(-59) : h;
}

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function stats(text) {
  const words = (text.replace(/```[\s\S]*?```/g, " ").match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
  const mins = Math.max(1, Math.round(words / 230));
  return `${words.toLocaleString("en-US")} words · ${mins} min read`;
}

/**
 * Split the document at its headings (h1-h3, outside code fences): one section per
 * heading, plus any text before the first. Each section is drawn on its own so the
 * outline can scroll to it.
 */
function sections(text) {
  const out = [{ heading: null, lines: [] }];
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ heading: { level: m[1].length, title: m[2].replace(/[`*_]/g, "") }, lines: [line] });
    else out[out.length - 1].lines.push(line);
  }
  return out
    .map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() }))
    .filter((s) => s.heading || s.text);
}

/** Drop YAML front matter: show it as a small table-ish block instead of raw dashes. */
function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: [], body: text };
  const meta = m[1]
    .split("\n")
    .map((l) => /^([\w-]+):\s*(.*)$/.exec(l))
    .filter(Boolean)
    .map((x) => [x[1], x[2].replace(/^["']|["']$/g, "")]);
  return { meta, body: text.slice(m[0].length) };
}

export default class MdViewer extends View {
  init(_props, cx) {
    this.file = props()?.file ?? null;
    this.follow = false;
    this.recent = [];
    this.text = null;
    this.problem = "";
    this.changedAt = 0;
    this.seenAt = Date.now();
    this.control = null;
    this.size = Number(localStorage.getItem("size")) || 15;
    this.showOutline = localStorage.getItem("outline") !== "off";
    this.width = 900;
    this.nonce = 0;
    this.doc = null;
    this.scroll = ScrollHandle.new();
    if (checking()) return;
    this.tick(cx);
    this.beat();
    this.section = 0;
    // Key commands (keys.json "mod:md-viewer" or "md-viewer.next"): next / prev section, top.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const n = this.doc?.secs.length ?? 0;
        if (!n) continue;
        if (c === "next") this.jump(Math.min(n - 1, this.section + 1), cx);
        else if (c === "prev") this.jump(Math.max(0, this.section - 1), cx);
        else if (c === "top") this.jump(0, cx);
      }
    });
    cx.timer.every(READ_MS, (cx) => this.tick(cx));
    cx.timer.every(BEAT_MS, (cx) => {
      this.beat();
      cx.notify(); // "updated … ago"
    });
  }

  tick(cx) {
    cx.spawn(async (cx) => {
      let changed = false;
      const ctl = props()?.control;
      if (ctl) {
        const raw = await readTextFile(ctl).catch(() => null);
        if (raw && raw !== this.control) {
          this.control = raw;
          try {
            const c = JSON.parse(raw);
            if (c.file && c.file !== this.file) this.switchTo(c.file);
            this.follow = !!c.follow;
            this.recent = Array.isArray(c.recent) ? c.recent : [];
            changed = true;
          } catch (e) {
            this.problem = `Can't read what Pi sent: ${e?.message ?? e}`;
          }
        }
      }
      if (this.file) {
        const text = await readTextFile(this.file).catch((e) => {
          this.problem = `Can't read ${this.file}: ${e?.message ?? e}`;
          return undefined;
        });
        if (text === null) {
          if (this.problem !== "missing") changed = true;
          this.problem = "missing";
        } else if (text !== undefined && text !== this.text) {
          if (this.text !== null) this.changedAt = Date.now();
          this.text = text;
          const fm = frontMatter(text);
          this.doc = { ...fm, secs: sections(fm.body) };
          this.problem = "";
          changed = true;
        }
      }
      if (changed) cx.notify();
    });
  }

  beat() {
    const id = props()?.id;
    if (!id) return;
    const file = `${appHome()}/mods/md-viewer/.alive/${id}.txt`;
    (async () => {
      const before = await readTextFile(file);
      await writeTextFile(file, String(Date.now()), before);
    })().catch(() => {});
  }

  switchTo(file) {
    this.file = file;
    this.text = null;
    this.doc = null;
    this.changedAt = 0;
    this.seenAt = Date.now();
    this.nonce++;
    this.section = 0;
    this.scroll.scroll_to_item(0);
  }

  open(file, cx) {
    if (file === this.file) return;
    this.switchTo(file);
    this.tick(cx);
  }

  setSize(delta, cx) {
    const i = Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(this.size) + delta));
    this.size = SIZES[i === -1 ? 2 : i];
    localStorage.setItem("size", String(this.size));
    cx.notify();
  }

  chip(t, id, label, onClick, active = false) {
    return div()
      .id(id)
      .flex_none()
      .px(7)
      .h(22)
      .rounded(5)
      .flex()
      .items_center()
      .text_size(11.5)
      .cursor_pointer()
      .text_color(active ? t.foreground : t.muted)
      .when(active, (s) => s.bg(t.selected))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(onClick)
      .child(label);
  }

  header(t) {
    const live = this.changedAt && Date.now() - this.changedAt < 4000;
    return h_flex()
      .flex_none()
      .h(40)
      .px(14)
      .gap(10)
      .items_center()
      .bg(t.chrome ?? t.surface)
      .border_b(1)
      .border_color(t.border)
      .child(
        div()
          .flex_none()
          .w(18)
          .h(22)
          .rounded(3)
          .border(1.5)
          .border_color(t.accent)
          .flex()
          .items_center()
          .justify_center()
          .text_size(8.5)
          .font_semibold()
          .text_color(t.accent)
          .child("MD"),
      )
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(div().text_size(13).font_semibold().text_color(t.foreground).truncate().child(base(this.file) || "Markdown"))
          .child(div().text_size(10.5).text_color(t.dim).truncate().child(shortDir(this.file))),
      )
      .when(!!live, (s) =>
        s.child(
          h_flex()
            .flex_none()
            .gap(5)
            .items_center()
            .child(div().size(6).rounded(3).bg(t.done ?? t.accent).loop("opacity", { from: 0.3, to: 1, period: 900 }))
            .child(div().text_size(11).text_color(t.done ?? t.accent).child("updated")),
        ),
      )
      .when(this.follow, (s) => s.child(div().flex_none().px(7).h(20).rounded(10).bg(t.accent + "22").text_color(t.accent).text_size(10.5).font_semibold().flex().items_center().child("Following")))
      .child(this.chip(t, "smaller", "A−", (_e, cx) => this.setSize(-1, cx)))
      .child(this.chip(t, "bigger", "A+", (_e, cx) => this.setSize(1, cx)))
      .child(
        this.chip(t, "toc", "Outline", (_e, cx) => {
          this.showOutline = !this.showOutline;
          localStorage.setItem("outline", this.showOutline ? "on" : "off");
          cx.notify();
        }, this.showOutline),
      )
      .when(!!this.file, (s) => s.child(this.chip(t, "reveal", "Open", () => exec("open", [this.file]).catch(() => {}))));
  }

  sidebar(t, heads) {
    const files = this.recent.filter((f) => f !== this.file).slice(0, 8);
    return v_flex()
      .id("side")
      .flex_none()
      .w(210)
      .h_full()
      .overflow_y_scrollbar()
      .py(18)
      .px(12)
      .gap(2)
      .border_r(1)
      .border_color(t.border)
      .bg(t.chrome ?? t.surface)
      .when(heads.length > 0, (s) =>
        s
          .child(div().px(6).pb(6).text_size(10.5).font_semibold().text_color(t.dim).child("ON THIS PAGE"))
          .children(
            heads.map((h, i) =>
              div()
                .id(`h-${i}`)
                .pl(6 + (h.level - 1) * 12)
                .pr(6)
                .py(3)
                .rounded(4)
                .text_size(h.level === 1 ? 12.5 : 12)
                .when(h.level === 1, (x) => x.font_semibold())
                .text_color(h.level === 1 ? t.foreground : t.muted)
                .truncate()
                .cursor_pointer()
                .hover((x) => x.bg(t.hover).text_color(t.foreground))
                .on_click((_e, cx) => this.jump(h.index, cx))
                .child(h.title),
            ),
          ),
      )
      .when(files.length > 0, (s) =>
        s
          .child(div().px(6).pt(18).pb(6).text_size(10.5).font_semibold().text_color(t.dim).child("RECENT"))
          .children(
            files.map((f, i) =>
              div()
                .id(`r-${i}`)
                .px(6)
                .py(3)
                .rounded(4)
                .text_size(12)
                .text_color(t.muted)
                .truncate()
                .cursor_pointer()
                .hover((x) => x.bg(t.hover).text_color(t.foreground))
                .on_click((_e, cx) => this.open(f, cx))
                .child(base(f)),
            ),
          ),
      );
  }

  empty(t, title, body) {
    return v_flex()
      .flex_1()
      .items_center()
      .justify_center()
      .gap(6)
      .child(div().text_size(14).font_semibold().text_color(t.muted).child(title))
      .child(div().text_size(12).text_color(t.dim).child(body));
  }

  body(t) {
    if (!this.file) return this.empty(t, "No file yet", "Run /md in Pi, or let the agent write a .md file.");
    if (this.problem === "missing") return this.empty(t, "File not found", shortDir(this.file) + "/" + base(this.file));
    if (this.problem) return this.empty(t, "Can't show this file", this.problem);
    if (this.text === null || !this.doc) return this.empty(t, "Loading…", "");
    const { meta, body, secs } = this.doc;
    const pad = this.width < 640 ? 20 : 44;
    const column = () => v_flex().w_full().max_w(760).px(pad);
    return v_flex()
      .id(`scroll-${this.nonce}`)
      .flex_1()
      .h_full()
      .overflow_y_scrollbar()
      .track_scroll(this.scroll)
      .items_center()
      .child(column().pt(28).pb(10).child(div().text_size(11).text_color(t.dim).child(`${stats(body)} · ${this.changedAt ? "updated " + ago(Date.now() - this.changedAt) : "shown " + ago(Date.now() - this.seenAt)}`)))
      .child(
        column().when(meta.length > 0, (s) =>
          s.pb(6).child(
            v_flex()
              .gap(3)
              .p(10)
              .rounded(6)
              .bg(t.surface)
              .border(1)
              .border_color(t.border)
              .children(
                meta.map(([k, v], i) =>
                  h_flex()
                    .id(`m-${i}`)
                    .gap(10)
                    .text_size(12)
                    .child(div().w(90).flex_none().text_color(t.dim).child(k))
                    .child(div().flex_1().text_color(t.muted).child(v)),
                ),
              ),
          ),
        ),
      )
      .children(
        secs.map((sec, i) =>
          column()
            .pt(i === 0 ? 0 : 14)
            .child(
              div()
                .w_full()
                .text_size(this.size)
                .line_height(1.6)
                .text_color(t.foreground)
                .child(TextView.markdown(`md-${this.nonce}-${i}`, sec.text).selectable(true)),
            ),
        ),
      )
      .child(column().h(120));
  }

  /** Scroll so section i starts at the top: jump past it to the end, then back up to it. */
  jump(i, cx) {
    this.section = i;
    const first = 2; // the stats line and the front-matter slot come before the sections
    const last = first + this.doc.secs.length; // the bottom spacer
    this.scroll.scroll_to_item(last);
    cx.notify();
    cx.timer.after(40, (cx) => {
      this.scroll.scroll_to_item(first + i);
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const heads = this.doc ? this.doc.secs.map((s, i) => (s.heading ? { ...s.heading, index: i } : null)).filter(Boolean) : [];
    const side = this.showOutline && this.width >= 760 && (heads.length > 1 || this.recent.length > 1);
    return v_flex()
      .id("root")
      .size_full()
      .bg(t.background)
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) < 1) return;
        this.width = size.width;
        cx.notify();
      })
      .child(this.header(t))
      .child(
        h_flex()
          .flex_1()
          .min_h(0)
          .when(side, (s) => s.child(this.sidebar(t, heads)))
          .child(this.body(t)),
      );
  }
}
