// Thanks for the inpiration Michael Jolley!
// https://github.com/MichaelJolley/michaeljolley/blob/main/scripts/readme/index.js
const Parser = require('rss-parser');
const fs = require('fs/promises');
const path = require('path');
const readmeFilePath = path.resolve(__dirname, '../README.md');

const START_VIDEO_LIST_MARKER = '<!-- VIDEO-LIST:START -->';
const END_VIDEO_LIST_MARKER = '<!-- VIDEO-LIST:END -->';
const VIDEO_MARKER_FINDER = new RegExp(
  START_VIDEO_LIST_MARKER + '(.|[\r\n])*?' + END_VIDEO_LIST_MARKER
);

const youtubeLists = [
  'PLcR4ZgxWXeICy2QVTV-6HuEHfl9DcAuq7', // nickyt.live
  'PLZWncRoWaoFxwV4ZoTC-TydJYZ1c_FEGJ', // Pomerium Live
];

const THUMBNAIL_QUALITIES = [
  'maxresdefault.jpg', // 1920x1080
  'sddefault.jpg', // 640x480
  'hqdefault.jpg', // 480x360
  'mqdefault.jpg', // 320x180
  'default.jpg', // 120x90
];

async function main() {
  // Get videos from all playlists with their source index
  const playlistVideos = await Promise.all(
    youtubeLists.map(async (playlistId, index) => {
      const videos = await getVideos(
        `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`
      );
      return videos.map((video) => ({...video, playlistIndex: index}));
    })
  );

  // Sort each playlist's videos by newest first
  playlistVideos.forEach((playlist) => {
    playlist.sort((a, b) => {
      const videoIdA = a.link.split('v=')[1];
      const videoIdB = b.link.split('v=')[1];
      return videoIdB.localeCompare(videoIdA);
    });
  });

  // Calculate available videos in each playlist (max 4 per playlist)
  const availableVideos = playlistVideos.map((playlist) => Math.min(playlist.length, 4));

  // Calculate unused slots from playlists that have fewer than 4 videos
  const unusedSlots = playlistVideos.reduce((total, playlist, index) => {
    return total + Math.max(0, 4 - playlist.length);
  }, 0);

  // Distribute unused slots to playlists that have more videos
  const playlistsWithExtra = playlistVideos.filter(
    (playlist) => playlist.length > 4
  ).length;
  const extraSlotsPerList =
    playlistsWithExtra > 0 ? Math.floor(unusedSlots / playlistsWithExtra) : 0;

  // Calculate max videos for each playlist
  const maxVideosPerPlaylist = playlistVideos.map((playlist) => {
    const baseMax = Math.min(playlist.length, 4);
    const extra = playlist.length > 4 ? extraSlotsPerList : 0;
    return Math.min(playlist.length, baseMax + extra);
  });

  // Select videos from each playlist up to their calculated maximum
  const selectedVideos = [];
  playlistVideos.forEach((playlist, index) => {
    const videosToTake = maxVideosPerPlaylist[index];
    selectedVideos.push(...playlist.slice(0, videosToTake));
  });

  // Sort final selection by playlist order, then by date within each playlist
  const finalVideos = selectedVideos.sort((a, b) => {
    if (a.playlistIndex !== b.playlistIndex) {
      return a.playlistIndex - b.playlistIndex;
    }
    const videoIdA = a.link.split('v=')[1];
    const videoIdB = b.link.split('v=')[1];
    return videoIdB.localeCompare(videoIdA);
  });

  const videosMarkup = await generateVideosMarkup(finalVideos);
  const template = await getTemplate();

  const newReadMe = template.replace(
    VIDEO_MARKER_FINDER,
    START_VIDEO_LIST_MARKER + videosMarkup + END_VIDEO_LIST_MARKER
  );

  await saveReadMe(newReadMe);

  // Log distribution for verification
  const finalCounts = finalVideos.reduce((counts, video) => {
    counts[video.playlistIndex] = (counts[video.playlistIndex] || 0) + 1;
    return counts;
  }, {});
  console.log('Videos per playlist:', finalCounts);
  console.log('Total videos:', finalVideos.length);
}

async function checkThumbnail(videoId, quality) {
  try {
    const response = await fetch(`https://img.youtube.com/vi/${videoId}/${quality}`);
    if (response.ok && response.headers.get('content-length') > 1000) {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

async function getBestThumbnail(videoId) {
  for (const quality of THUMBNAIL_QUALITIES) {
    if (await checkThumbnail(videoId, quality)) {
      return `https://img.youtube.com/vi/${videoId}/${quality}`;
    }
  }
  // If all qualities fail, return the default
  return `https://img.youtube.com/vi/${videoId}/default.jpg`;
}

async function generateVideosMarkup(videos) {
  let markup = '<aside>';

  for (const video of videos) {
    const {link, title} = video;
    const videoId = link.split('v=')[1];
    const thumbnailUrl = await getBestThumbnail(videoId);

    markup += `<a href="${link}" title="${title}"><img src="${thumbnailUrl}" alt="${title}" width="400" height="225" loading="lazy" /></a>&nbsp;&nbsp;`;
  }

  markup += '</aside>';

  return markup;
}

async function getVideos(videoFeedUrl) {
  const parser = new Parser({
    customFields: {
      item: ['media:group', 'media:thumbnail'],
    },
  });

  try {
    const feed = await parser.parseURL(videoFeedUrl);

    return feed.items.map((m) => ({
      title: m.title,
      link: m.link,
      description: m['media:group']['media:description'][0],
      thumbnail: m['media:group']['media:thumbnail'][0].$.url,
    }));
  } catch (error) {
    console.error(`Error fetching feed from ${videoFeedUrl}:`, error);
    return [];
  }
}

async function getTemplate() {
  return await fs.readFile(readmeFilePath, 'utf-8');
}

async function saveReadMe(newReadMe) {
  await fs.writeFile(readmeFilePath, newReadMe);
}

main().catch(console.error);
