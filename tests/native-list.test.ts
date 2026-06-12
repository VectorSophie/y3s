import { beforeEach, expect, test } from "vitest";
import { parseRows } from "../src/content/native-list";

function rowHtml(o: { v: string; title: string; channel: string; dur?: string }): string {
  return `
  <ytd-playlist-video-renderer>
    <ytd-thumbnail><ytd-thumbnail-overlay-time-status-renderer><span id="text">${o.dur ?? ""}</span></ytd-thumbnail-overlay-time-status-renderer></ytd-thumbnail>
    <a id="video-title" href="/watch?v=${o.v}&list=PLx" title="${o.title}">${o.title}</a>
    <ytd-channel-name><div id="text"><a>${o.channel}</a></div></ytd-channel-name>
  </ytd-playlist-video-renderer>`;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

test("parseRows maps rows to NativeRow with durationSec + index + element", () => {
  document.body.innerHTML =
    rowHtml({ v: "a", title: "First", channel: "Chan A", dur: "3:33" }) +
    rowHtml({ v: "b", title: "Second", channel: "Chan B" });
  const rows = parseRows();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ videoId: "a", title: "First", channel: "Chan A", durationText: "3:33", durationSec: 213, index: 0 });
  expect(rows[0].el.tagName.toLowerCase()).toBe("ytd-playlist-video-renderer");
  expect(rows[1]).toMatchObject({ videoId: "b", index: 1, durationSec: undefined });
});

test("parseRows skips rows without a videoId", () => {
  document.body.innerHTML = `<ytd-playlist-video-renderer><a id="video-title" href="/playlist?list=PLx">x</a></ytd-playlist-video-renderer>`;
  expect(parseRows()).toHaveLength(0);
});
