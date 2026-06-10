import { beforeEach, expect, test } from "vitest";
import { scrapeTracks } from "../src/content/youtube-scrape";

// Minimal stand-in for a YouTube playlist row.
function rowHtml(opts: { v: string; title: string; channel: string; dur?: string; thumb?: string }): string {
  return `
  <ytd-playlist-video-renderer>
    <ytd-thumbnail>
      ${opts.thumb ? `<img src="${opts.thumb}">` : `<img>`}
      <ytd-thumbnail-overlay-time-status-renderer>
        <span id="text">${opts.dur ?? ""}</span>
      </ytd-thumbnail-overlay-time-status-renderer>
    </ytd-thumbnail>
    <a id="video-title" href="/watch?v=${opts.v}&list=PLx" title="${opts.title}">${opts.title}</a>
    <ytd-channel-name><div id="text"><a href="/@chan">${opts.channel}</a></div></ytd-channel-name>
  </ytd-playlist-video-renderer>`;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

test("scrapes title, videoId, channel, duration, thumbnail, position", () => {
  document.body.innerHTML =
    rowHtml({ v: "aaa", title: "First", channel: "Chan A", dur: "3:33", thumb: "http://t/a.jpg" }) +
    rowHtml({ v: "bbb", title: "Second", channel: "Chan B", dur: "4:12" });

  const tracks = scrapeTracks("PLx");
  expect(tracks).toHaveLength(2);
  expect(tracks[0]).toMatchObject({
    videoId: "aaa",
    title: "First",
    channelTitle: "Chan A",
    durationText: "3:33",
    thumbnailUrl: "http://t/a.jpg",
    position: 0,
  });
  expect(tracks[0].playlistItemId).toBe(""); // unknown from DOM
  expect(tracks[1]).toMatchObject({ videoId: "bbb", position: 1 });
  expect(tracks[1].thumbnailUrl).toBeUndefined();
});

test("skips rows with no videoId", () => {
  document.body.innerHTML = `<ytd-playlist-video-renderer><a id="video-title" href="/playlist?list=PLx">x</a></ytd-playlist-video-renderer>`;
  expect(scrapeTracks("PLx")).toHaveLength(0);
});
