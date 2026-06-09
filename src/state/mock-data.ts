// Mock playlist fixture for UI development without OAuth configured.
// Includes deliberate edge cases: duplicate title, repeated channel, a very
// long title, and a track with a missing thumbnail.

import type { PlaylistSnapshot, Track } from "../shared/types";

function thumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

const RAW: Array<Omit<Track, "playlistItemId" | "position" | "url">> = [
  { videoId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", channelTitle: "Rick Astley", thumbnailUrl: thumb("dQw4w9WgXcQ"), durationText: "3:33" },
  { videoId: "kJQP7kiw5Fk", title: "Despacito", channelTitle: "Luis Fonsi", thumbnailUrl: thumb("kJQP7kiw5Fk"), durationText: "4:42" },
  { videoId: "9bZkp7q19f0", title: "Gangnam Style", channelTitle: "officialpsy", thumbnailUrl: thumb("9bZkp7q19f0"), durationText: "4:13" },
  { videoId: "OPf0YbXqDm0", title: "Uptown Funk", channelTitle: "Mark Ronson", thumbnailUrl: thumb("OPf0YbXqDm0"), durationText: "4:31" },
  // Long title edge case
  { videoId: "L_jWHffIx5E", title: "All Star but every word is replaced with the entire Bee Movie script read aloud at increasing speed (do not watch)", channelTitle: "Smash Mouth", thumbnailUrl: thumb("L_jWHffIx5E"), durationText: "3:21" },
  { videoId: "fJ9rUzIMcZQ", title: "Bohemian Rhapsody", channelTitle: "Queen Official", thumbnailUrl: thumb("fJ9rUzIMcZQ"), durationText: "5:59" },
  // Missing thumbnail edge case
  { videoId: "missingthumb1", title: "Unlisted Demo (no thumbnail)", channelTitle: "Bedroom Producer", durationText: "2:48" },
  { videoId: "JGwWNGJdvx8", title: "Shape of You", channelTitle: "Ed Sheeran", thumbnailUrl: thumb("JGwWNGJdvx8"), durationText: "4:24" },
  // Duplicate title edge case (same title, different id)
  { videoId: "rYEDA3JcQqw", title: "Rolling in the Deep", channelTitle: "Adele", thumbnailUrl: thumb("rYEDA3JcQqw"), durationText: "3:48" },
  { videoId: "rYEDA3JcQ22", title: "Rolling in the Deep", channelTitle: "Adele (Live)", thumbnailUrl: thumb("rYEDA3JcQqw"), durationText: "4:05" },
  // Repeated channel edge case (Ed Sheeran again)
  { videoId: "2Vv-BfVoq4g", title: "Perfect", channelTitle: "Ed Sheeran", thumbnailUrl: thumb("2Vv-BfVoq4g"), durationText: "4:40" },
  { videoId: "Jdf-T1Krf4o", title: "Castle on the Hill", channelTitle: "Ed Sheeran", thumbnailUrl: thumb("Jdf-T1Krf4o"), durationText: "4:21" },
  { videoId: "RgKAFK5djSk", title: "See You Again", channelTitle: "Wiz Khalifa", thumbnailUrl: thumb("RgKAFK5djSk"), durationText: "3:58" },
  { videoId: "hT_nvWreIhg", title: "Counting Stars", channelTitle: "OneRepublic", thumbnailUrl: thumb("hT_nvWreIhg"), durationText: "4:17" },
  { videoId: "CevxZvSJLk8", title: "Roar", channelTitle: "Katy Perry", thumbnailUrl: thumb("CevxZvSJLk8"), durationText: "3:43" },
  { videoId: "YQHsXMglC9A", title: "Hello", channelTitle: "Adele", thumbnailUrl: thumb("YQHsXMglC9A"), durationText: "6:07" },
  { videoId: "09R8_2nJtjg", title: "Sugar", channelTitle: "Maroon 5", thumbnailUrl: thumb("09R8_2nJtjg"), durationText: "5:01" },
  { videoId: "e-ORhEE9VVg", title: "Blank Space", channelTitle: "Taylor Swift", thumbnailUrl: thumb("e-ORhEE9VVg"), durationText: "4:33" },
  { videoId: "pRpeEdMmmQ0", title: "Shake It Off", channelTitle: "Taylor Swift", thumbnailUrl: thumb("pRpeEdMmmQ0"), durationText: "4:03" },
  { videoId: "lp-EO5I60KA", title: "Thinking Out Loud", channelTitle: "Ed Sheeran", thumbnailUrl: thumb("lp-EO5I60KA"), durationText: "4:59" },
  { videoId: "60ItHLz5WEA", title: "Faded", channelTitle: "Alan Walker", thumbnailUrl: thumb("60ItHLz5WEA"), durationText: "3:32" },
  { videoId: "papuvlVeZg8", title: "Stressed Out", channelTitle: "twenty one pilots", thumbnailUrl: thumb("papuvlVeZg8"), durationText: "3:22" },
];

export function makeMockSnapshot(playlistId: string): PlaylistSnapshot {
  const items: Track[] = RAW.map((t, i) => ({
    ...t,
    playlistItemId: `MOCK_ITEM_${i}`,
    position: i,
    url: `https://www.youtube.com/watch?v=${t.videoId}&list=${playlistId}`,
  }));
  return {
    playlistId,
    title: "Mock Playlist — y3s dev mode",
    items,
    fetchedAt: Date.now(),
    isMock: true,
  };
}
