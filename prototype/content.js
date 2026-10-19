// y3s demo prototype: native-looking playlist tools on regular YouTube.
// Everything here only changes what is shown on the page. Nothing is written
// to your YouTube account; reload the page and the playlist is back as it was.
(() => {
  "use strict";
  if (window.__y3sDemo) return;
  window.__y3sDemo = true;

  // ---------------------------------------------------------------- helpers
  // No innerHTML anywhere: YouTube enforces Trusted Types.
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  const SVGNS = "http://www.w3.org/2000/svg";
  function icon(d) {
    const s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("class", "y3s-icon");
    s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", d);
    s.append(p);
    return s;
  }

  const I = {
    search:
      "M20.87 20.17l-5.59-5.59C16.35 13.35 17 11.75 17 10c0-3.87-3.13-7-7-7s-7 3.13-7 7 3.13 7 7 7c1.75 0 3.35-.65 4.58-1.71l5.59 5.59.7-.71zM10 16c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z",
    close:
      "M12.7 12l6.65-6.65-.71-.71L12 11.29 5.35 4.65l-.71.71L11.29 12l-6.65 6.65.71.71L12 12.71l6.65 6.65.71-.71L12.7 12z",
    sort: "M21 6H3V5h18v1zm-6 5H3v1h12v-1zm-6 6H3v1h6v-1z",
    top: "M5 4h14v1H5V4zm7 2.29l5.35 5.36-.7.7L12.5 8.21V20h-1V8.21l-4.15 4.14-.7-.7L12 6.29z",
    bottom: "M5 19h14v1H5v-1zm7-1.29l-5.35-5.36.7-.7 4.15 4.14V4h1v11.79l4.15-4.14.7.7L12 17.71z",
    trash:
      "M11 17H9V8h2v9zm4-9h-2v9h2V8zm4-4v1h-1v16H6V5H5V4h4V3h6v1h4zm-2 1H7v15h10V5z",
    play: "M7 5.25v13.5L18.25 12 7 5.25zm1 1.77L16.31 12 8 16.98V7.02z",
    locate:
      "M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm9 3.5h-2.03A7.002 7.002 0 0012.5 5.03V3h-1v2.03A7.002 7.002 0 005.03 11.5H3v1h2.03a7.002 7.002 0 006.47 6.47V21h1v-2.03a7.002 7.002 0 006.47-6.47H21v-1zM12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z",
    check: "M9.55 18l-5.7-5.7 1.425-1.425L9.55 15.15l9.175-9.175L20.15 7.4z",
    keyboard:
      "M16 16H8v-2h8v2zm0-5h-2v2h2v-2zm3 0h-2v2h2v-2zm-6 0h-2v2h2v-2zm-3 0H8v2h2v-2zm-3 0H5v2h2v-2zm9-3h-2v2h2V8zm3 0h-2v2h2V8zm-6 0h-2v2h2V8zm-3 0H8v2h2V8zM7 8H5v2h2V8zm15-3v14H2V5h20zm-1 1H3v12h18V6z",
  };

  const isEditable = (el) =>
    !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  const TIME_RE = /^\d{1,2}(?::\d{2}){1,2}$/;
  const toSec = (t) => t.split(":").reduce((a, p) => a * 60 + Number(p), 0);
  function fmtTotal(sec) {
    const hrs = Math.floor(sec / 3600);
    const min = Math.floor((sec % 3600) / 60);
    return hrs ? `${hrs}h ${min}m` : `${min}m`;
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // All reads of YouTube's markup live here, so a YouTube change is one fix.
  function rowInfo(row) {
    const a = row.querySelector('a#video-title, a#wc-endpoint, a[href*="/watch?v="]');
    const m = /[?&]v=([^&]+)/.exec(a?.getAttribute("href") || "");
    const t = row.querySelector("#video-title");
    const title = (t?.getAttribute("title") || t?.textContent || "").trim();
    const ch = row.querySelector("ytd-channel-name #text, ytd-channel-name, #byline");
    let dur = null;
    for (const el of row.querySelectorAll(
      "ytd-thumbnail-overlay-time-status-renderer #text, .badge-shape-wiz__text, .yt-badge-shape__text, badge-shape, #overlays span, #overlays div",
    )) {
      const s = el.textContent.trim();
      if (TIME_RE.test(s)) {
        dur = toSec(s);
        break;
      }
    }
    const unavailable =
      /^\[(private|deleted|unavailable)/i.test(title) || row.hasAttribute("is-unavailable");
    return {
      el: row,
      id: m ? m[1] : null,
      title,
      channel: (ch?.textContent || "").trim().split("\n")[0].trim(),
      dur,
      unavailable,
      anchor: a,
    };
  }

  // --------------------------------------------------------------- snackbar
  const snack = {
    el: null,
    timer: 0,
    show(msg, action) {
      if (!this.el || !this.el.isConnected) {
        this.el = h("div", { class: "y3s-snackbar", role: "status", "aria-live": "polite" });
        document.body.append(this.el);
      }
      this.el.replaceChildren(
        ...[h("span", { class: "y3s-snackbar-text", text: msg }),
        action
          ? h("button", {
              class: "y3s-snackbar-action",
              text: action.label,
              onclick: () => {
                this.hide();
                action.run();
              },
            })
          : null,
        ].filter(Boolean),
      );
      // force reflow so the slide-in replays
      void this.el.offsetWidth;
      this.el.classList.add("y3s-open");
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.hide(), 6000);
    },
    hide() {
      this.el?.classList.remove("y3s-open");
    },
  };

  // ------------------------------------------------------------------- menu
  let menuEl = null;
  let menuAnchor = null;
  function closeMenu() {
    menuEl?.remove();
    menuEl = null;
    menuAnchor = null;
    document.removeEventListener("pointerdown", onDocDown, true);
  }
  function onDocDown(e) {
    if (menuEl && !menuEl.contains(e.target) && !menuAnchor?.contains(e.target)) closeMenu();
  }
  function openMenu(anchor, items) {
    if (menuAnchor === anchor) return closeMenu();
    closeMenu();
    const buttons = [];
    const menu = h(
      "div",
      { class: "y3s-menu", role: "menu" },
      items.map((it) => {
        if (it.sep) return h("div", { class: "y3s-menu-sep", role: "separator" });
        const b = h(
          "button",
          {
            class: "y3s-menu-item",
            role: "menuitemradio",
            "aria-checked": it.checked ? "true" : "false",
            onclick: () => {
              closeMenu();
              anchor.focus();
              it.run();
            },
          },
          it.checked ? icon(I.check) : h("span", { class: "y3s-icon-spacer" }),
          h("span", { text: it.label }),
        );
        buttons.push(b);
        return b;
      }),
    );
    menu.addEventListener("keydown", (e) => {
      const i = buttons.indexOf(document.activeElement);
      if (e.key === "ArrowDown") buttons[(i + 1) % buttons.length].focus();
      else if (e.key === "ArrowUp") buttons[(i - 1 + buttons.length) % buttons.length].focus();
      else if (e.key === "Escape") {
        closeMenu();
        anchor.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8))}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
    menuEl = menu;
    menuAnchor = anchor;
    document.addEventListener("pointerdown", onDocDown, true);
    (buttons.find((b) => b.getAttribute("aria-checked") === "true") || buttons[0])?.focus();
  }

  // ----------------------------------------------------------- help dialog
  const SHORTCUTS = [
    [["j"], "Next video"],
    [["k"], "Previous video"],
    [["Shift", "j / k"], "Extend selection"],
    [["x"], "Select or deselect"],
    [["Enter"], "Play"],
    [["/"], "Filter this playlist"],
    [["g"], "First video"],
    [["Shift", "g"], "Last video"],
    [["t"], "Move selection to top"],
    [["b"], "Move selection to bottom"],
    [["Delete"], "Remove selection"],
    [["z"], "Undo"],
    [["Esc"], "Clear filter or selection"],
    [["?"], "Show keyboard shortcuts"],
  ];
  function openHelp() {
    if (document.querySelector(".y3s-dialog-backdrop")) return;
    const prev = document.activeElement;
    const close = () => {
      bd.remove();
      prev?.focus?.();
    };
    const closeBtn = h(
      "button",
      { class: "y3s-icon-btn", "aria-label": "Close", onclick: close },
      icon(I.close),
    );
    const bd = h(
      "div",
      {
        class: "y3s-dialog-backdrop",
        onclick: (e) => {
          if (e.target === bd) close();
        },
        onkeydown: (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        },
      },
      h(
        "div",
        { class: "y3s-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Keyboard shortcuts" },
        h("div", { class: "y3s-dialog-head" }, h("h2", { text: "Keyboard shortcuts" }), closeBtn),
        h(
          "div",
          { class: "y3s-sc-list" },
          SHORTCUTS.map(([keys, desc]) =>
            h(
              "div",
              { class: "y3s-sc-row" },
              h("span", { class: "y3s-sc-desc", text: desc }),
              h(
                "span",
                { class: "y3s-sc-keys" },
                keys.map((k, i) => [i ? h("span", { class: "y3s-plus", text: "+" }) : null, h("kbd", { text: k })]),
              ),
            ),
          ),
        ),
        h("p", {
          class: "y3s-dialog-note",
          text: "y3s demo · changes only affect this page and are not saved to YouTube.",
        }),
      ),
    );
    document.body.append(bd);
    closeBtn.focus();
  }

  // ======================================================= playlist page
  class PlaylistTools {
    constructor(list) {
      this.list = list;
      this.contents = list.querySelector("#contents") || list;
      this.playlistId = new URLSearchParams(location.search).get("list");
      this.query = "";
      this.chip = "all";
      this.sortKey = "manual";
      this.selected = new Set();
      this.focus = null;
      this.anchorRow = null;
      this.lastSnap = null;
      this.seq = 0;
      this.infos = new Map();
      this.dupIds = new Set();
      this.buildBar();
      list.before(this.bar);
      list.before(this.empty);
      this.obs = new MutationObserver(() => this.schedule());
      this.obs.observe(this.contents, { childList: true });
      this.refresh();
    }

    destroy() {
      this.obs.disconnect();
      clearTimeout(this.timer);
      this.bar.remove();
      this.empty.remove();
      this.list.classList.remove("y3s-selecting");
      for (const r of this.rows()) {
        r.querySelector(":scope > .y3s-cbwrap")?.remove();
        r.classList.remove("y3s-row", "y3s-hidden", "y3s-removed", "y3s-selected", "y3s-focus");
      }
      closeMenu();
    }

    schedule() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.refresh(), 120);
    }

    checkPlaylistId() {
      const id = new URLSearchParams(location.search).get("list");
      if (id === this.playlistId) return;
      this.playlistId = id;
      this.selected.clear();
      this.focus = null;
      this.lastSnap = null;
      this.sortKey = "manual";
      this.chip = "all";
      this.searchInput.value = this.query = "";
      this.refresh();
    }

    // ---- data
    rows() {
      return [...this.contents.children].filter((el) => el.matches("ytd-playlist-video-renderer"));
    }
    live(r) {
      return !r.classList.contains("y3s-removed");
    }
    visibleRows() {
      return this.rows().filter((r) => this.live(r) && !r.classList.contains("y3s-hidden"));
    }
    continuation() {
      return this.contents.querySelector(":scope > ytd-continuation-item-renderer");
    }

    decorate(row) {
      if (row.dataset.y3sOrig == null) row.dataset.y3sOrig = String(this.seq++);
      row.classList.add("y3s-row");
      if (row.querySelector(":scope > .y3s-cbwrap")) return;
      const cb = h("button", {
        class: "y3s-cb",
        role: "checkbox",
        "aria-checked": "false",
        "aria-label": "Select video",
        tabindex: "-1",
      });
      cb.append(icon(I.check));
      const wrap = h("div", { class: "y3s-cbwrap" }, cb);
      wrap.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onCheck(row, e.shiftKey);
      });
      row.prepend(wrap);
    }

    refresh() {
      const rows = this.rows();
      this.infos = new Map(rows.map((r) => [r, rowInfo(r)]));
      rows.forEach((r) => this.decorate(r));
      for (const r of this.selected) if (!r.isConnected || !this.live(r)) this.selected.delete(r);
      const counts = new Map();
      for (const i of this.infos.values()) {
        if (i.id && this.live(i.el)) counts.set(i.id, (counts.get(i.id) || 0) + 1);
      }
      this.dupIds = new Set([...counts].filter(([, c]) => c > 1).map(([id]) => id));
      this.applyFilter();
      this.render();
    }

    applyFilter() {
      const tokens = this.query.toLowerCase().split(/\s+/).filter(Boolean);
      for (const [r, i] of this.infos) {
        const hay = `${i.title} ${i.channel} ${i.id}`.toLowerCase();
        let ok = tokens.every((t) => hay.includes(t));
        if (ok && this.chip === "dups") ok = this.dupIds.has(i.id);
        if (ok && this.chip === "unavail") ok = i.unavailable;
        r.classList.toggle("y3s-hidden", !ok);
      }
      if (this.focus && (this.focus.classList.contains("y3s-hidden") || !this.live(this.focus))) {
        this.setFocus(null);
      }
    }

    // ---- UI
    buildBar() {
      this.searchInput = h("input", {
        type: "text",
        placeholder: "Filter this playlist",
        "aria-label": "Filter this playlist",
        spellcheck: "false",
        autocomplete: "off",
        oninput: () => {
          this.query = this.searchInput.value;
          this.applyFilter();
          this.render();
        },
        onkeydown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this.searchInput.blur();
            this.setFocus(this.visibleRows()[0] || null);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (this.searchInput.value) this.clearQuery();
            else this.searchInput.blur();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            this.searchInput.blur();
            this.setFocus(this.visibleRows()[0] || null);
          }
        },
      });
      this.clearBtn = h(
        "button",
        { class: "y3s-icon-btn y3s-clear", "aria-label": "Clear filter", onclick: () => this.clearQuery() },
        icon(I.close),
      );
      const search = h(
        "div",
        { class: "y3s-search", onclick: () => this.searchInput.focus() },
        icon(I.search),
        this.searchInput,
        this.clearBtn,
      );

      const mkChip = (key, label) =>
        h("button", { class: "y3s-chip", "aria-pressed": "false", onclick: () => this.setChip(key) }, label);
      this.chipEls = {
        all: mkChip("all", "All"),
        dups: mkChip("dups", "Duplicates"),
        unavail: mkChip("unavail", "Unavailable"),
      };
      this.sortLabel = h("span", { text: "Sort" });
      this.sortChip = h(
        "button",
        { class: "y3s-chip y3s-chip-icon", "aria-haspopup": "menu", onclick: () => this.openSort() },
        icon(I.sort),
        this.sortLabel,
      );
      this.dupAction = h("button", {
        class: "y3s-btn y3s-btn-text",
        text: "Remove extra copies",
        onclick: () => this.removeExtraCopies(),
      });

      this.statsText = h("span");
      this.loadAllBtn = h("button", {
        class: "y3s-link",
        text: "Load all",
        onclick: () => this.loadAll(),
      });
      const helpBtn = h(
        "button",
        { class: "y3s-icon-btn", "aria-label": "Keyboard shortcuts", title: "Keyboard shortcuts (?)", onclick: openHelp },
        icon(I.keyboard),
      );
      this.stats = h("div", { class: "y3s-stats" }, this.statsText, this.loadAllBtn, helpBtn);

      const normal = h(
        "div",
        { class: "y3s-bar-normal" },
        h("div", { class: "y3s-bar-row" }, search, this.stats),
        h(
          "div",
          { class: "y3s-chips", role: "toolbar", "aria-label": "Filters" },
          this.chipEls.all,
          this.chipEls.dups,
          this.chipEls.unavail,
          h("span", { class: "y3s-chip-sep" }),
          this.sortChip,
          this.dupAction,
        ),
      );

      // selection mode, replaces the normal bar (Google Photos style)
      this.selCount = h("span", { class: "y3s-sel-count" });
      const act = (label, ic, fn) =>
        h("button", { class: "y3s-btn", onclick: fn }, icon(ic), h("span", { text: label }));
      this.selectAllBtn = h("button", {
        class: "y3s-btn y3s-btn-text",
        onclick: () => this.selectAllVisible(),
      });
      const selecting = h(
        "div",
        { class: "y3s-bar-select" },
        h(
          "button",
          { class: "y3s-icon-btn", "aria-label": "Clear selection", onclick: () => this.clearSelection() },
          icon(I.close),
        ),
        this.selCount,
        this.selectAllBtn,
        h(
          "div",
          { class: "y3s-sel-actions" },
          act("Play", I.play, () => this.playSelected()),
          act("Move to top", I.top, () => this.moveTo("top")),
          act("Move to bottom", I.bottom, () => this.moveTo("bottom")),
          act("Remove", I.trash, () => this.removeSelected()),
        ),
      );

      this.bar = h("div", { class: "y3s-bar" }, normal, selecting);
      this.empty = h(
        "div",
        { class: "y3s-empty", hidden: true },
        h("p", { class: "y3s-empty-title", text: "No videos match" }),
        h("button", { class: "y3s-btn", text: "Clear filters", onclick: () => this.clearAllFilters() }),
      );
    }

    render() {
      const live = this.rows().filter((r) => this.live(r));
      const vis = live.filter((r) => !r.classList.contains("y3s-hidden"));
      const total = live.reduce((s, r) => s + (this.infos.get(r)?.dur || 0), 0);
      const unavail = live.filter((r) => this.infos.get(r)?.unavailable).length;
      const dupRows = live.filter((r) => this.dupIds.has(this.infos.get(r)?.id)).length;
      const filtering = this.query.trim() || this.chip !== "all";
      const more = !!this.continuation();

      this.statsText.textContent = filtering
        ? `${vis.length} of ${live.length}${more ? "+" : ""} videos`
        : `${plural(live.length, "video")}${more ? "+" : ""} · ${fmtTotal(total)}`;
      this.loadAllBtn.hidden = !more;
      this.clearBtn.hidden = !this.query;

      this.chipEls.dups.textContent = dupRows ? `Duplicates · ${dupRows}` : "Duplicates";
      this.chipEls.unavail.textContent = unavail ? `Unavailable · ${unavail}` : "Unavailable";
      for (const [k, el] of Object.entries(this.chipEls)) el.setAttribute("aria-pressed", String(this.chip === k));
      this.dupAction.hidden = !(this.chip === "dups" && this.dupIds.size);

      this.empty.hidden = !(filtering && vis.length === 0);

      // selection
      const n = this.selected.size;
      this.bar.classList.toggle("y3s-selecting", n > 0);
      this.list.classList.toggle("y3s-selecting", n > 0);
      this.selCount.textContent = `${n} selected`;
      const notSelected = vis.filter((r) => !this.selected.has(r)).length;
      this.selectAllBtn.hidden = notSelected === 0;
      this.selectAllBtn.textContent = filtering ? `Select all ${vis.length} matching` : `Select all ${vis.length}`;
      for (const r of this.rows()) {
        const on = this.selected.has(r);
        r.classList.toggle("y3s-selected", on);
        r.querySelector(":scope > .y3s-cbwrap > .y3s-cb")?.setAttribute("aria-checked", String(on));
      }
    }

    setChip(k) {
      this.chip = this.chip === k && k !== "all" ? "all" : k;
      this.applyFilter();
      this.render();
    }
    clearQuery() {
      this.searchInput.value = this.query = "";
      this.applyFilter();
      this.render();
    }
    clearAllFilters() {
      this.chip = "all";
      this.clearQuery();
    }

    // ---- selection & focus
    onCheck(row, shift) {
      const vis = this.visibleRows();
      if (shift && this.anchorRow && vis.includes(this.anchorRow)) {
        const a = vis.indexOf(this.anchorRow);
        const b = vis.indexOf(row);
        const on = !this.selected.has(row);
        for (const r of vis.slice(Math.min(a, b), Math.max(a, b) + 1)) on ? this.selected.add(r) : this.selected.delete(r);
      } else if (this.selected.has(row)) this.selected.delete(row);
      else this.selected.add(row);
      this.anchorRow = row;
      this.setFocus(row, false);
      this.render();
    }
    clearSelection() {
      this.selected.clear();
      this.render();
    }
    selectAllVisible() {
      for (const r of this.visibleRows()) this.selected.add(r);
      this.render();
    }
    setFocus(row, scroll = true) {
      this.focus?.classList.remove("y3s-focus");
      this.focus = row;
      if (!row) return;
      row.classList.add("y3s-focus");
      if (scroll) row.scrollIntoView({ block: "nearest" });
    }
    moveFocus(d, extend) {
      const vis = this.visibleRows();
      if (!vis.length) return;
      let i = vis.indexOf(this.focus);
      i = i < 0 ? (d > 0 ? 0 : vis.length - 1) : Math.max(0, Math.min(vis.length - 1, i + d));
      if (extend) {
        if (this.focus) this.selected.add(this.focus);
        this.selected.add(vis[i]);
        this.anchorRow = vis[i];
        this.render();
      }
      this.setFocus(vis[i]);
    }

    // ---- edits (local only, each one undoable)
    orderedSelection() {
      return this.rows().filter((r) => this.selected.has(r));
    }
    reorder(order) {
      const end = this.continuation();
      for (const r of order) this.contents.insertBefore(r, end);
    }
    renumber() {
      let n = 0;
      for (const r of this.rows()) {
        if (!this.live(r)) continue;
        n++;
        const idx = r.querySelector("#index");
        if (idx && /^\d*$/.test(idx.textContent.trim())) idx.textContent = String(n);
      }
    }
    commit(label, fn) {
      const snap = { order: this.rows(), removed: this.rows().filter((r) => !this.live(r)), sortKey: this.sortKey };
      fn();
      this.renumber();
      this.lastSnap = snap;
      this.refresh();
      snack.show(label, { label: "Undo", run: () => this.undo() });
    }
    undo() {
      const snap = this.lastSnap;
      if (!snap) return;
      this.lastSnap = null;
      this.reorder(snap.order.filter((r) => r.isConnected));
      for (const r of this.rows()) r.classList.toggle("y3s-removed", snap.removed.includes(r));
      this.sortKey = snap.sortKey;
      this.updateSortLabel();
      this.renumber();
      this.refresh();
      snack.show("Undone");
    }
    moveTo(where) {
      const sel = this.orderedSelection();
      if (!sel.length) return;
      const rest = this.rows().filter((r) => !this.selected.has(r));
      this.commit(`Moved ${plural(sel.length, "video")} to ${where}`, () => {
        this.reorder(where === "top" ? [...sel, ...rest] : [...rest, ...sel]);
        this.sortKey = "manual";
        this.updateSortLabel();
      });
      sel[0].scrollIntoView({ block: "nearest" });
    }
    removeSelected() {
      const sel = this.orderedSelection();
      if (!sel.length) return;
      this.commit(`Removed ${plural(sel.length, "video")}`, () => {
        sel.forEach((r) => r.classList.add("y3s-removed"));
        this.selected.clear();
      });
    }
    removeExtraCopies() {
      const seen = new Set();
      const extra = [];
      for (const r of this.rows()) {
        const id = this.infos.get(r)?.id;
        if (!id || !this.live(r)) continue;
        if (seen.has(id)) extra.push(r);
        else seen.add(id);
      }
      if (!extra.length) return;
      this.commit(`Removed ${plural(extra.length, "extra copy")}`.replace("copys", "copies"), () => {
        extra.forEach((r) => r.classList.add("y3s-removed"));
        extra.forEach((r) => this.selected.delete(r));
        this.chip = "all";
      });
    }
    playSelected() {
      const ids = this.orderedSelection()
        .map((r) => this.infos.get(r)?.id)
        .filter(Boolean);
      if (!ids.length) return;
      // watch_videos builds a temporary queue from up to 50 ids
      location.href = `https://www.youtube.com/watch_videos?video_ids=${ids.slice(0, 50).join(",")}`;
    }

    // ---- sorting
    static SORTS = [
      ["manual", "Playlist order"],
      ["title", "Title (A–Z)"],
      ["channel", "Channel (A–Z)"],
      ["short", "Shortest first"],
      ["long", "Longest first"],
      ["reverse", "Reverse current order"],
      ["shuffle", "Shuffle once"],
    ];
    updateSortLabel() {
      const name = {
        manual: "Sort",
        title: "Title",
        channel: "Channel",
        short: "Shortest",
        long: "Longest",
        shuffle: "Shuffled",
        reverse: "Reversed",
      }[this.sortKey];
      this.sortLabel.textContent = this.sortKey === "manual" ? "Sort" : `Sort: ${name}`;
      this.sortChip.setAttribute("aria-pressed", String(this.sortKey !== "manual"));
    }
    openSort() {
      openMenu(
        this.sortChip,
        PlaylistTools.SORTS.map(([key, label]) => ({
          label,
          checked: key === this.sortKey,
          run: () => this.sortBy(key),
        })),
      );
    }
    sortBy(key) {
      const rows = this.rows();
      const inf = (r) => this.infos.get(r) || {};
      const cmpText = (f) => (a, b) => inf(a)[f].localeCompare(inf(b)[f], undefined, { sensitivity: "base", numeric: true });
      const durOr = (r, d) => (inf(r).dur == null ? d : inf(r).dur);
      let order;
      switch (key) {
        case "manual":
          order = [...rows].sort((a, b) => a.dataset.y3sOrig - b.dataset.y3sOrig);
          break;
        case "title":
          order = [...rows].sort(cmpText("title"));
          break;
        case "channel":
          order = [...rows].sort((a, b) => cmpText("channel")(a, b) || cmpText("title")(a, b));
          break;
        case "short":
          order = [...rows].sort((a, b) => durOr(a, Infinity) - durOr(b, Infinity));
          break;
        case "long":
          order = [...rows].sort((a, b) => durOr(b, -1) - durOr(a, -1));
          break;
        case "reverse":
          order = [...rows].reverse();
          break;
        case "shuffle":
          order = [...rows];
          for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
          }
          break;
      }
      const label = PlaylistTools.SORTS.find(([k]) => k === key)[1];
      this.commit(key === "manual" ? "Back to playlist order" : `Sorted: ${label}`, () => {
        this.reorder(order);
        this.sortKey = key;
        this.updateSortLabel();
      });
    }

    // ---- load the rest of a long playlist
    async loadAll() {
      if (this.loading) return;
      this.loading = true;
      this.loadAllBtn.textContent = "Loading…";
      const y = scrollY;
      const start = Date.now();
      let last = -1;
      while (this.continuation() && Date.now() - start < 90000) {
        const n = this.rows().length;
        if (n === last) await new Promise((r) => setTimeout(r, 800));
        last = n;
        this.continuation()?.scrollIntoView({ block: "end" });
        await new Promise((r) => setTimeout(r, 700));
        if (this.rows().length === n && !this.continuation()) break;
      }
      scrollTo({ top: y });
      this.loading = false;
      this.loadAllBtn.textContent = "Load all";
      this.refresh();
      snack.show(`Loaded ${plural(this.rows().length, "video")}`);
    }

    // ---- keyboard
    onKey(e) {
      if (e.defaultPrevented) return;
      if (document.querySelector(".y3s-dialog-backdrop") || menuEl) return;
      if (isEditable(e.target) || e.target.closest?.("ytd-searchbox, #search, tp-yt-paper-dialog")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.ctrlKey || e.metaKey) && e.key === "z" && this.lastSnap && !e.shiftKey) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.undo();
        }
        return;
      }
      const sel = this.selected.size > 0;
      let handled = true;
      switch (e.key) {
        case "j":
          this.moveFocus(1);
          break;
        case "k":
          this.moveFocus(-1);
          break;
        case "J":
          this.moveFocus(1, true);
          break;
        case "K":
          this.moveFocus(-1, true);
          break;
        case "x":
          if (this.focus) this.onCheck(this.focus, false);
          else handled = false;
          break;
        case "Enter":
          if (this.focus && !e.target.closest?.("button, a")) this.infos.get(this.focus)?.anchor?.click();
          else handled = false;
          break;
        case "/":
          this.searchInput.focus();
          this.searchInput.select();
          break;
        case "g":
          this.setFocus(this.visibleRows()[0] || null);
          break;
        case "G":
          this.setFocus(this.visibleRows().at(-1) || null);
          break;
        case "t":
          if (sel) this.moveTo("top");
          else handled = false;
          break;
        case "b":
          if (sel) this.moveTo("bottom");
          else handled = false;
          break;
        case "Delete":
        case "Backspace":
          if (sel) this.removeSelected();
          else handled = false;
          break;
        case "z":
          if (this.lastSnap) this.undo();
          else handled = false;
          break;
        case "?":
          openHelp();
          break;
        case "Escape":
          if (sel) this.clearSelection();
          else if (this.query || this.chip !== "all") this.clearAllFilters();
          else if (this.focus) this.setFocus(null);
          else handled = false;
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
  }

  // ================================================== watch page panel
  class PanelTools {
    constructor(panel) {
      this.panel = panel;
      this.items = panel.querySelector("#items");
      this.input = h("input", {
        type: "text",
        placeholder: "Filter playlist",
        "aria-label": "Filter playlist",
        spellcheck: "false",
        autocomplete: "off",
        oninput: () => this.refresh(),
        onkeydown: (e) => {
          // keep YouTube's player shortcuts from reacting while typing
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            this.visible()[0] && rowInfo(this.visible()[0]).anchor?.click();
          } else if (e.key === "Escape") {
            e.preventDefault();
            if (this.input.value) {
              this.input.value = "";
              this.refresh();
            } else this.input.blur();
          }
        },
      });
      this.clearBtn = h(
        "button",
        {
          class: "y3s-icon-btn y3s-clear",
          "aria-label": "Clear filter",
          onclick: () => {
            this.input.value = "";
            this.refresh();
            this.input.focus();
          },
        },
        icon(I.close),
      );
      this.count = h("span", { class: "y3s-panel-count" });
      this.bar = h(
        "div",
        { class: "y3s-panel-bar" },
        h(
          "div",
          { class: "y3s-search y3s-search-compact", onclick: () => this.input.focus() },
          icon(I.search),
          this.input,
          this.clearBtn,
        ),
        this.count,
        h(
          "button",
          {
            class: "y3s-icon-btn",
            "aria-label": "Jump to now playing",
            title: "Jump to now playing",
            onclick: () => this.jumpToCurrent(),
          },
          icon(I.locate),
        ),
      );
      this.items.before(this.bar);
      this.obs = new MutationObserver(() => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.refresh(), 120);
      });
      this.obs.observe(this.items, { childList: true });
      this.refresh();
    }
    destroy() {
      this.obs.disconnect();
      this.bar.remove();
      this.rows().forEach((r) => r.classList.remove("y3s-hidden"));
    }
    rows() {
      return [...this.items.querySelectorAll(":scope > ytd-playlist-panel-video-renderer")];
    }
    visible() {
      return this.rows().filter((r) => !r.classList.contains("y3s-hidden"));
    }
    refresh() {
      const tokens = this.input.value.toLowerCase().split(/\s+/).filter(Boolean);
      const rows = this.rows();
      let n = 0;
      for (const r of rows) {
        const i = rowInfo(r);
        const ok = tokens.every((t) => `${i.title} ${i.channel}`.toLowerCase().includes(t));
        r.classList.toggle("y3s-hidden", !ok);
        if (ok) n++;
      }
      this.clearBtn.hidden = !this.input.value;
      this.count.textContent = tokens.length ? `${n} of ${rows.length}` : "";
    }
    jumpToCurrent() {
      const cur = this.rows().find((r) => r.hasAttribute("selected"));
      if (!cur) return;
      if (cur.classList.contains("y3s-hidden")) {
        this.input.value = "";
        this.refresh();
      }
      cur.scrollIntoView({ block: "center", behavior: "smooth" });
      cur.classList.remove("y3s-flash");
      void cur.offsetWidth;
      cur.classList.add("y3s-flash");
    }
  }

  // ============================================================ mounting
  const shown = (el) => el && !el.closest("[hidden]") && el.getClientRects().length > 0;
  let pl = null;
  let pn = null;

  function tick() {
    try {
      const listEl =
        location.pathname === "/playlist"
          ? [...document.querySelectorAll("ytd-playlist-video-list-renderer")].find(shown) || null
          : null;
      if (pl && (pl.list !== listEl || !pl.bar.isConnected)) {
        pl.destroy();
        pl = null;
      }
      if (!pl && listEl) pl = new PlaylistTools(listEl);
      pl?.checkPlaylistId();

      const panelEl =
        location.pathname === "/watch"
          ? [...document.querySelectorAll("ytd-playlist-panel-renderer")].find(
              (p) => p.querySelector("#items") && shown(p),
            ) || null
          : null;
      if (pn && (pn.panel !== panelEl || !pn.bar.isConnected)) {
        pn.destroy();
        pn = null;
      }
      if (!pn && panelEl) pn = new PanelTools(panelEl);
    } catch (err) {
      console.warn("[y3s demo]", err);
    }
  }

  window.addEventListener("keydown", (e) => pl && location.pathname === "/playlist" && pl.onKey(e), true);
  window.addEventListener("yt-navigate-finish", () => setTimeout(tick, 50));
  setInterval(tick, 1000);
  tick();
  console.info("[y3s demo] loaded");
})();
