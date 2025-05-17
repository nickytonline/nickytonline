require('dotenv').config();
const {google} = require('googleapis');
const fs = require('fs/promises');
const path = require('path');
const Parser = require('rss-parser');
const readmeFilePath = path.resolve(__dirname, '../README.md');

const START_VIDEO_LIST_MARKER = '<!-- VIDEO-LIST:START -->';
const END_VIDEO_LIST_MARKER = '<!-- VIDEO-LIST:END -->';
const VIDEO_MARKER_FINDER = new RegExp(
  START_VIDEO_LIST_MARKER + '(.|[\r\n])*?' + END_VIDEO_LIST_MARKER
);

const {YOUTUBE_API_KEY} = process.env;

const playlists = [
  {
    id: 'PLcR4ZgxWXeICy2QVTV-6HuEHfl9DcAuq7', // nickyt.live
    reversed: false,
  },
  {
    id: 'PLZDPKYkCEQk07B0HWWOKH3bqpqOUQuOOk', // 2 Full 2 Stack
    reversed: true,
  },
  {
    id: 'PLZWncRoWaoFxwV4ZoTC-TydJYZ1c_FEGJ', // Pomerium Live
    reversed: false,
  },
  {
    id: 'PLcR4ZgxWXeIAa0VXPJQ7fgXkx73A5TeGU', // Guest Appearances
    reversed: false,
  },
] as const;

const THUMBNAIL_QUALITIES = [
  'maxresdefault.jpg',
  'sddefault.jpg',
  'hqdefault.jpg',
  'mqdefault.jpg',
  'default.jpg',
];

async function main() {
  // Get videos from all playlists with their source index
  const playlistVideos = await Promise.all(
    playlists.map(async (playlist, index) => {
      let videos;

      if (playlist.reversed) {
        // Use YouTube API for reversed playlists
        videos = await getVideosFromAPI(playlist.id, 2);
      } else {
        // Use RSS for non-reversed playlists
        videos = await getVideosFromRSS(
          `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlist.id}`
        );
      }

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

      return sortedVideos.slice(0, 2);
    })
    .flat();

  // Sort final selection by playlist order
  const finalVideos = selectedVideos.sort((a, b) => {
    if (a.playlistIndex !== b.playlistIndex) {
      return a.playlistIndex - b.playlistIndex;
    }
    return b.timestamp - a.timestamp;
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
    counts[video.playlistIndex] = (counts[video.playlistIndex] ?? 0) + 1;
    return counts;
  }, {});
  console.log('Videos per playlist:', finalCounts);
  console.log('Total videos:', finalVideos.length);
}

async function getVideosFromAPI(playlistId: string, maxVideos) {
  const youtube = google.youtube({
    version: 'v3',
    auth: YOUTUBE_API_KEY,
  });

  try {
    // First get total items in playlist
    const playlistInfo = await youtube.playlistItems.list({
      part: 'id',
      playlistId: playlistId,
      maxResults: 1,
    });

    const totalItems = playlistInfo.data.pageInfo.totalResults;
    console.log(`Playlist ${playlistId} has ${totalItems} total items`);

    const pageSize = 20; // Items per page
    const lastPageIndex = Math.floor((totalItems - 1) / pageSize);
    const secondLastPageIndex = Math.max(0, lastPageIndex - 1);

    // Get tokens for both last and second-to-last pages
    const lastPageToken = await getPageToken(youtube, playlistId, lastPageIndex, pageSize);
    const secondLastPageToken = await getPageToken(youtube, playlistId, secondLastPageIndex, pageSize);

    // Get both pages
    const [lastPageResponse, secondLastPageResponse] = await Promise.all([
      youtube.playlistItems.list({
        part: 'snippet,contentDetails',
        playlistId: playlistId,
        maxResults: pageSize,
        pageToken: lastPageToken,
      }),
      youtube.playlistItems.list({
        part: 'snippet,contentDetails',
        playlistId: playlistId,
        maxResults: pageSize,
        pageToken: secondLastPageToken,
      })
    ]);

    // Combine items from both pages
    const items = [
      ...(secondLastPageResponse.data.items || []),
      ...(lastPageResponse.data.items || [])
    ];

    console.log(`Retrieved ${items.length} items from playlist ${playlistId} (${secondLastPageResponse.data.items?.length || 0} from second-to-last page, ${lastPageResponse.data.items?.length || 0} from last page)`);

    const lastTwoItems = items.slice(-maxVideos);
    console.log(`Selected ${lastTwoItems.length} items from playlist ${playlistId}`);

    return lastTwoItems.map((item) => ({
      title: item.snippet.title,
      link: `https://www.youtube.com/watch?v=${item.contentDetails.videoId}`,
      description: item.snippet.description,
      thumbnail: item.snippet.thumbnails.medium.url,
      timestamp: new Date(item.snippet.publishedAt).getTime(),
    }));
  } catch (error) {
    console.error(`Error fetching playlist ${playlistId} from API:`, error);
    return [];
  }
}

async function getVideosFromRSS(videoFeedUrl) {
  const parser = new Parser({
    customFields: {
      item: ['media:group', 'media:thumbnail', 'published'],
    },
  });

  try {
    const feed = await parser.parseURL(videoFeedUrl);
    console.log(`Retrieved ${feed.items.length} items from RSS feed ${videoFeedUrl}`);

    return feed.items.map((m) => ({
      title: m.title,
      link: m.link,
      description: m['media:group']['media:description'][0],
      thumbnail: m['media:group']['media:thumbnail'][0].$.url,
      timestamp: new Date(m.published).getTime(),
    }));
  } catch (error) {
    console.error(`Error fetching feed from ${videoFeedUrl}:`, error);
    return [];
  }
}

async function checkThumbnail(videoId, quality) {
  try {
    const response = await fetch(`https://img.youtube.com/vi/${videoId}/${quality}`);
    if (response.ok && Number(response.headers.get('content-length')) > 1000) {
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

async function getTemplate(): Promise<string> {
  return await fs.readFile(readmeFilePath, 'utf-8');
}

async function saveReadMe(newReadMe) {
  await fs.writeFile(readmeFilePath, newReadMe);
}

async function getPageToken(youtube, playlistId, targetPage, pageSize) {
  if (targetPage === 0) return undefined;

  let currentPage = 0;
  let currentToken;

  while (currentPage < targetPage) {
    const response = await youtube.playlistItems.list({
      part: 'id',
      playlistId: playlistId,
      maxResults: pageSize,
      pageToken: currentToken,
    });

    currentToken = response.data.nextPageToken;
    currentPage++;

    if (!currentToken) {
      console.log(`No more pages after page ${currentPage} for playlist ${playlistId}`);
      break;
    }
  }

  return currentToken;
}

main();
