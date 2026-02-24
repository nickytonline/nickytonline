require('dotenv').config();
const {google} = require('googleapis');
const fs = require('fs/promises');
const path = require('path');
const readmeFilePath = path.resolve(__dirname, '../README.md');

const START_VIDEO_LIST_MARKER = '<!-- VIDEO-LIST:START -->';
const END_VIDEO_LIST_MARKER = '<!-- VIDEO-LIST:END -->';
const VIDEO_MARKER_FINDER = new RegExp(
  START_VIDEO_LIST_MARKER + '(.|[\\r\\n])*?' + END_VIDEO_LIST_MARKER
);

const {YOUTUBE_API_KEY} = process.env;

const playlists = [
  {
    id: 'PLcR4ZgxWXeICy2QVTV-6HuEHfl9DcAuq7', // nickyt.live
  },
  {
    id: 'PLZWncRoWaoFxwV4ZoTC-TydJYZ1c_FEGJ', // Pomerium Live
  },
  {
    id: 'PLcR4ZgxWXeIAa0VXPJQ7fgXkx73A5TeGU', // Guest Appearances
  },
] as const;

const THUMBNAIL_QUALITIES = ['maxres', 'standard', 'high', 'medium', 'default'] as const;

async function main() {
  const youtube = google.youtube({version: 'v3', auth: YOUTUBE_API_KEY});

  // Get videos from all playlists with their source index
  const playlistVideos = await Promise.all(
    playlists.map(async (playlist, index) => {
      const videos = await getVideosFromAPI(youtube, playlist.id);
      return videos.map((video) => ({...video, playlistIndex: index}));
    })
  );

  // Sort and limit videos according to playlist settings
  const selectedVideos = playlistVideos
    .map((playlist, index) => {
      const playlistConfig = playlists[index];
      const sortedVideos = playlist.sort((a, b) => {
        if (playlistConfig.reversed) {
          return a.timestamp - b.timestamp;
        }
        return b.timestamp - a.timestamp;
      });

      return sortedVideos.slice(0, 4);
    })
    .flat();

  // Sort final selection by playlist order
  const finalVideos = selectedVideos.sort((a, b) => {
    if (a.playlistIndex !== b.playlistIndex) {
      return a.playlistIndex - b.playlistIndex;
    }
    return b.timestamp - a.timestamp;
  });

  const videosMarkup = generateVideosMarkup(finalVideos);
  const template = await getTemplate();

  const newReadMe = template.replace(
    VIDEO_MARKER_FINDER,
    START_VIDEO_LIST_MARKER + videosMarkup + END_VIDEO_LIST_MARKER
  );

  await saveReadMe(newReadMe);

  // Log distribution for verification
  const finalCounts = finalVideos.reduce((counts, video) => {
    counts[video.playlistIndex] = (counts[video.playlistIndex] ?? 0) + 1;
    return counts;
  }, {});
  console.log('Videos per playlist:', finalCounts);
  console.log('Total videos:', finalVideos.length);
}

async function getVideosFromAPI(youtube, playlistId: string) {
  const videos = [];
  let nextPageToken: string | undefined;

  do {
    const response = await youtube.playlistItems.list({
      part: ['snippet'],
      playlistId,
      maxResults: 50,
      pageToken: nextPageToken,
    });

    for (const item of response.data.items) {
      const {snippet} = item;
      if (snippet.title === 'Deleted video' || snippet.title === 'Private video') {
        continue;
      }
      videos.push({
        title: snippet.title,
        link: `https://www.youtube.com/watch?v=${snippet.resourceId.videoId}`,
        description: snippet.description,
        thumbnail: getBestThumbnail(snippet.thumbnails),
        timestamp: new Date(snippet.publishedAt).getTime(),
      });
    }

    nextPageToken = response.data.nextPageToken;
  } while (nextPageToken);

  console.log(`Retrieved ${videos.length} videos from playlist ${playlistId}`);
  return videos;
}

function getBestThumbnail(thumbnails) {
  for (const quality of THUMBNAIL_QUALITIES) {
    if (thumbnails[quality]?.url) {
      return thumbnails[quality].url;
    }
  }
  return null;
}

function generateVideosMarkup(videos) {
  let markup = '<aside>';

  for (const video of videos) {
    const {link, title, thumbnail} = video;
    markup += `<a href="${link}" title="${title}"><img src="${thumbnail}" alt="${title}" width="400" height="225" loading="lazy" /></a>&nbsp;&nbsp;`;
  }

  markup += '</aside>';

  return markup;
}

async function getTemplate(): Promise<string> {
  return await fs.readFile(readmeFilePath, 'utf-8');
}

async function saveReadMe(newReadMe) {
  await fs.writeFile(readmeFilePath, newReadMe);
}

main();
