// Pure serializers + thin clipboard/download helpers for exporting rows.

import type { NativeRow } from "../shared/types";

interface Flat {
  position: number;
  title: string;
  channel: string;
  videoId: string;
  duration: string;
  url: string;
}

function flatten(rows: NativeRow[]): Flat[] {
  return rows.map((r, i) => ({
    position: i + 1,
    title: r.title,
    channel: r.channel ?? "",
    videoId: r.videoId,
    duration: r.durationText ?? "",
    url: `https://www.youtube.com/watch?v=${r.videoId}`,
  }));
}

export function toJSON(rows: NativeRow[]): string {
  return JSON.stringify(flatten(rows), null, 2);
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCSV(rows: NativeRow[]): string {
  const header = "position,title,channel,videoId,duration,url";
  const lines = flatten(rows).map((f) =>
    [f.position, f.title, f.channel, f.videoId, f.duration, f.url]
      .map((v) => csvCell(String(v)))
      .join(","),
  );
  return [header, ...lines].join("\n");
}

export function toMarkdown(rows: NativeRow[]): string {
  return flatten(rows)
    .map((f) => `${f.position}. [${f.title}](${f.url}) — ${f.channel} (${f.duration})`)
    .join("\n");
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function downloadFile(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
