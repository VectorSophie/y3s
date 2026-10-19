// Tiny DOM builder. No innerHTML anywhere: YouTube enforces Trusted Types.

type Child = Node | string | null | undefined | false | Child[];
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2), v as EventListener);
    } else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, kids);
  return el;
}

function append(el: Element, kids: Child[]): void {
  for (const kid of kids) {
    if (Array.isArray(kid)) append(el, kid);
    else if (kid != null && kid !== false) el.append(kid);
  }
}

const SVGNS = "http://www.w3.org/2000/svg";

export function icon(d: string): SVGSVGElement {
  const s = document.createElementNS(SVGNS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", "y3s-icon");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVGNS, "path");
  p.setAttribute("d", d);
  s.append(p);
  return s;
}

/** Outline icons in YouTube's 24px style. */
export const ICONS = {
  search:
    "M20.87 20.17l-5.59-5.59C16.35 13.35 17 11.75 17 10c0-3.87-3.13-7-7-7s-7 3.13-7 7 3.13 7 7 7c1.75 0 3.35-.65 4.58-1.71l5.59 5.59.7-.71zM10 16c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z",
  close:
    "M12.7 12l6.65-6.65-.71-.71L12 11.29 5.35 4.65l-.71.71L11.29 12l-6.65 6.65.71.71L12 12.71l6.65 6.65.71-.71L12.7 12z",
  sort: "M21 6H3V5h18v1zm-6 5H3v1h12v-1zm-6 6H3v1h6v-1z",
  top: "M5 4h14v1H5V4zm7 2.29l5.35 5.36-.7.7L12.5 8.21V20h-1V8.21l-4.15 4.14-.7-.7L12 6.29z",
  bottom: "M5 19h14v1H5v-1zm7-1.29l-5.35-5.36.7-.7 4.15 4.14V4h1v11.79l4.15-4.14.7.7L12 17.71z",
  trash: "M11 17H9V8h2v9zm4-9h-2v9h2V8zm4-4v1h-1v16H6V5H5V4h4V3h6v1h4zm-2 1H7v15h10V5z",
  play: "M7 5.25v13.5L18.25 12 7 5.25zm1 1.77L16.31 12 8 16.98V7.02z",
  locate:
    "M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm9 3.5h-2.03A7.002 7.002 0 0012.5 5.03V3h-1v2.03A7.002 7.002 0 005.03 11.5H3v1h2.03a7.002 7.002 0 006.47 6.47V21h1v-2.03a7.002 7.002 0 006.47-6.47H21v-1zM12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z",
  check: "M9.55 18l-5.7-5.7 1.425-1.425L9.55 15.15l9.175-9.175L20.15 7.4z",
  phases: "M3 4h18v1H3V4zm0 15h18v1H3v-1zm4-11h14v1H7V8zm0 4h14v1H7v-1zm0 4h14v1H7v-1zM3 8h2v1H3V8zm0 4h2v1H3v-1zm0 4h2v1H3v-1z",
  chevron: "M12 15.7l-6.4-6.3.7-.7 5.7 5.6 5.7-5.6.7.7z",
  more:
    "M12 16.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5zM10.5 12c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5-1.5.67-1.5 1.5zm0-6c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5-1.5.67-1.5 1.5z",
  keyboard:
    "M16 16H8v-2h8v2zm0-5h-2v2h2v-2zm3 0h-2v2h2v-2zm-6 0h-2v2h2v-2zm-3 0H8v2h2v-2zm-3 0H5v2h2v-2zm9-3h-2v2h2V8zm3 0h-2v2h2V8zm-6 0h-2v2h2V8zm-3 0H8v2h2V8zM7 8H5v2h2V8zm15-3v14H2V5h20zm-1 1H3v12h18V6z",
} as const;

export const isEditable = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement &&
  (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
