// "Check this page": what y3s can find on the YouTube page you're on, so a
// YouTube redesign can be fixed from a pasted report. No titles, names or
// other content are included, only counts and the shape of the markup.

import { sendMessage } from "../shared/messages";
import { h, icon, ICONS } from "./ui/dom";
import { readRow, SEL, site } from "./yt-dom";

const n = (sel: string) => document.querySelectorAll(sel).length;
const yes = (sel: string) => (document.querySelector(sel) ? "yes" : "no");

/** Tag#id.class outline of an element, without any text. */
function outline(el: Element | null, depth = 0, max = 4): string[] {
  if (!el || depth > max) return [];
  const cls = [...el.classList].filter((c) => !c.startsWith("y3s-")).slice(0, 3);
  const line = `${"  ".repeat(depth)}${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls.length ? `.${cls.join(".")}` : ""}`;
  const kids = [...el.children].slice(0, 6).flatMap((c) => outline(c, depth + 1, max));
  return [line, ...kids];
}

export async function pageReport(): Promise<string> {
  const out: string[] = [];
  const add = (k: string, v: unknown) => out.push(`${k}: ${v}`);
  add("y3s", chrome.runtime.getManifest().version);
  add("site", `${location.host}${location.pathname}`);
  add("list param", new URLSearchParams(location.search).has("list") ? "yes" : "no");
  add("theme", document.documentElement.hasAttribute("dark") ? "dark" : "light");
  try {
    const st = await sendMessage({ type: "AUTH_STATUS" });
    add("sign-in", st.ok ? (st.data.signedIn ? "signed in" : st.data.configured ? "signed out" : "not configured") : st.error.code);
  } catch {
    add("sign-in", "no answer from the extension");
  }

  const s = SEL;
  out.push("", "[playlist page]");
  add("list", n(s.playlistList));
  const rows = [...document.querySelectorAll<HTMLElement>(s.playlistRow)];
  add("rows", rows.length);
  const data = rows.slice(0, 200).map(readRow);
  add("rows with video id", data.filter((r) => r.videoId).length);
  add("rows with title", data.filter((r) => r.title).length);
  add("rows with channel", data.filter((r) => r.channel).length);
  add("rows with duration", data.filter((r) => r.duration !== null).length);
  add("continuation", n(s.continuation));
  add("y3s bar", yes(".y3s-bar"));
  add("phase dividers", n(".y3s-phase"));

  out.push("", "[watch page]");
  add("playlist panel", n(s.panel));
  add("panel rows", n(s.panelRow));
  add("panel selected row", n(`${s.panelRow}[selected]`));
  add("player", yes(s.player));
  add("video element", n(`${s.player} video`));
  add("player right controls", yes(s.playerControls));
  add("player next button", yes(".ytp-next-button"));
  add("y3s player controls", yes(".y3s-ytp"));
  add("miniplayer", yes("ytd-app[miniplayer-is-active], ytd-miniplayer[active]"));

  out.push("", "[other]");
  add("save sheet (old)", n("ytd-add-to-playlist-renderer"));
  add("save sheet (new) items", n("toggleable-list-item-view-model"));
  add("playlists grid", n("ytd-rich-grid-renderer"));
  add("site mode", site());

  const first = rows[0] ?? document.querySelector(s.panelRow);
  if (first) out.push("", "[first row markup]", ...outline(first));
  return out.join("\n");
}

export async function openPageCheck(): Promise<void> {
  document.querySelector(".y3s-check-backdrop")?.remove();
  const text = await pageReport();
  const pre = h("pre", { class: "y3s-check-pre", text });
  const status = h("span", { class: "y3s-check-status" });
  const close = () => bd.remove();
  const bd = h(
    "div",
    {
      class: "y3s-dialog-backdrop y3s-check-backdrop",
      onclick: (e: Event) => {
        if (e.target === bd) close();
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === "Escape") close();
      },
    },
    h(
      "div",
      { class: "y3s-dialog", role: "dialog", "aria-modal": "true", "aria-label": "y3s page check" },
      h(
        "div",
        { class: "y3s-dialog-head" },
        h("h2", { text: "y3s page check" }),
        h("button", { class: "y3s-icon-btn", "aria-label": "Close", onclick: close }, icon(ICONS.close)),
      ),
      h("p", {
        class: "y3s-dialog-text",
        text: "What y3s finds on this page. It has no titles or names in it, just counts and the shape of the page. Paste it to whoever is fixing y3s.",
      }),
      pre,
      h(
        "div",
        { class: "y3s-dialog-actions" },
        status,
        h("button", {
          class: "y3s-btn y3s-btn-primary",
          text: "Copy",
          "data-autofocus": true,
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(text);
              status.textContent = "Copied";
            } catch {
              const r = document.createRange();
              r.selectNodeContents(pre);
              getSelection()?.removeAllRanges();
              getSelection()?.addRange(r);
              status.textContent = "Selected: press Ctrl+C";
            }
          },
        }),
      ),
    ),
  );
  document.body.append(bd);
  (bd.querySelector("[data-autofocus]") as HTMLElement).focus();
}
