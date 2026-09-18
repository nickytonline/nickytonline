require('dotenv').config();
const {google} = require('googleapis');
const fs = require('fs/promises');
const path = require('path');
const Parser = require('rss-parser');
const readmeFilePath = path.resolve(__dirname, '../README.md');

const START_SCHEDULE_MARKER = '<!-- STREAM-SCHEDULE:START -->';
const END_SCHEDULE_MARKER = '<!-- STREAM-SCHEDULE:END -->';
const SCHEDULE_MARKER_FINDER = new RegExp(
  START_SCHEDULE_MARKER + '(.|[\r\n])*?' + END_SCHEDULE_MARKER,
);

const FEED_URL = 'https://www.nickyt.co/stream-schedule-feed.xml';
const YOUTUBE_CHANNEL_HANDLES = ['@pomerium_io'];
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

async function main() {
  try {
    const youtube = YOUTUBE_API_KEY
      ? google.youtube({version: 'v3', auth: YOUTUBE_API_KEY})
      : undefined;
    const streams = await getAllUpcomingStreams(youtube);
    const scheduleMarkup = await generateScheduleMarkup(streams);
    const template = await getTemplate();

    const newReadMe = template.replace(
      SCHEDULE_MARKER_FINDER,
      START_SCHEDULE_MARKER + scheduleMarkup + END_SCHEDULE_MARKER,
    );

    await saveReadMe(newReadMe);
    console.log(`Updated README with ${streams.length} upcoming streams`);
  } catch (error) {
    console.error('Error updating stream schedule:', error);
  }
}

async function getAllUpcomingStreams(youtube) {
  const feedStreams = await getUpcomingStreams();
  const youtubeStreams = youtube ? await getUpcomingYouTubeStreams(youtube) : [];

  return [...feedStreams, ...youtubeStreams]
    .filter(
      (stream, index, streams) =>
        streams.findIndex((candidate) => candidate.link === stream.link) === index,
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

async function getUpcomingStreams() {
  const parser = new Parser({
    customFields: {
      item: [['media:thumbnail', 'thumbnail', {keepArray: false}]],
    },
  });

  try {
    const feed = await parser.parseURL(FEED_URL);
    const now = new Date();

    // Filter and transform stream entries
    return feed.items
      .map((item) => ({
        title: item.title,
        date: new Date(item.isoDate),
        link: item.link,
        guest:
          item.link
            .split('-')
            .pop()
            ?.replace(/\d{4}.*$/, '') || 'TBD',
        description: item.content || '',
        thumbnailUrl: item.thumbnail?.$.url || '',
      }))
      .filter((stream) => stream.date > now) // Only future streams
      .sort((a, b) => a.date.getTime() - b.date.getTime()); // Sort by date ascending
  } catch (error) {
    console.error('Error fetching stream schedule:', error);
    return [];
  }
}

async function getUpcomingYouTubeStreams(youtube) {
  const now = new Date();
  const streams = [];

  for (const handle of YOUTUBE_CHANNEL_HANDLES) {
    try {
      const channelResponse = await youtube.channels.list({
        part: ['id'],
        forHandle: handle,
      });
      const channelId = channelResponse.data.items?.[0]?.id;

      if (!channelId) {
        console.warn(`Could not find YouTube channel for ${handle}`);
        continue;
      }

      const searchResponse = await youtube.search.list({
        part: ['snippet'],
        channelId,
        eventType: 'upcoming',
        maxResults: 50,
        order: 'date',
        type: ['video'],
      });
      const videoIds = searchResponse.data.items
        ?.map((item) => item.id?.videoId)
        .filter(Boolean);

      if (!videoIds?.length) {
        continue;
      }

      const videosResponse = await youtube.videos.list({
        part: ['liveStreamingDetails', 'snippet'],
        id: videoIds,
      });

      for (const video of videosResponse.data.items ?? []) {
        const scheduledStartTime = video.liveStreamingDetails?.scheduledStartTime;
        const videoId = video.id;
        const date = scheduledStartTime
          ? new Date(scheduledStartTime)
          : undefined;

        if (!videoId || !date || Number.isNaN(date.getTime()) || date <= now) {
          continue;
        }

        streams.push({
          title: video.snippet?.title,
          date,
          link: `https://www.youtube.com/watch?v=${videoId}`,
          description: video.snippet?.description || '',
          thumbnailUrl: getBestThumbnail(video.snippet?.thumbnails),
        });
      }
    } catch (error) {
      console.error(`Error fetching upcoming YouTube streams for ${handle}:`, error);
    }
  }

  return streams;
}

async function generateScheduleMarkup(streams) {
  if (streams.length === 0) {
    return '\n<p>No upcoming streams scheduled at the moment.</p>\n';
  }

  const streamItems: {link: string; title: string; thumbnailUrl: string}[] = [];

  for (const stream of streams) {
    const formattedDate = stream.date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    const title = `${stream.title} - ${formattedDate}`;
    let thumbnailUrl = stream.thumbnailUrl;

    // Only try YouTube thumbnails if we don't have one from the RSS feed
    if (!thumbnailUrl) {
      const url = new URL(stream.link);
      const videoId = url.searchParams.get('v') ?? url.pathname.split('/live/')[1];
      if (videoId) {
        for (const quality of [
          'maxresdefault.jpg',
          'sddefault.jpg',
          'hqdefault.jpg',
          'mqdefault.jpg',
          'default.jpg',
        ]) {
          const url = `https://img.youtube.com/vi/${videoId}/${quality}`;
          try {
            const response = await fetch(url, {signal: AbortSignal.timeout(5000)});
            if (response.ok) {
              thumbnailUrl = url;
              break;
            }
          } catch (error) {
            console.error(`Failed to fetch thumbnail: ${url}`);
            continue;
          }
        }
      }
    }

    if (thumbnailUrl) {
      streamItems.push({link: stream.link, title, thumbnailUrl});
    }
  }

  let markup = '<table border="0">';

  for (let i = 0; i < streamItems.length; i += 2) {
    markup += '<tr>';
    const {link, title, thumbnailUrl} = streamItems[i];
    markup += `<td><a href="${link}" title="${title}"><img src="${thumbnailUrl}" alt="${title}" width="360" height="203" loading="lazy" /></a></td>`;
    if (streamItems[i + 1]) {
      const {link: link2, title: title2, thumbnailUrl: thumbnailUrl2} = streamItems[i + 1];
      markup += `<td><a href="${link2}" title="${title2}"><img src="${thumbnailUrl2}" alt="${title2}" width="360" height="203" loading="lazy" /></a></td>`;
    } else {
      markup += '<td></td>';
    }
    markup += '</tr>';
  }

  markup += '</table>';
  return markup;
}

function getBestThumbnail(thumbnails) {
  for (const quality of [
    'maxres',
    'standard',
    'high',
    'medium',
    'default',
  ]) {
    if (thumbnails?.[quality]?.url) {
      return thumbnails[quality].url;
    }
  }

  return '';
}

async function getTemplate(): Promise<string> {
  return await fs.readFile(readmeFilePath, 'utf-8');
}

async function saveReadMe(newReadMe) {
  await fs.writeFile(readmeFilePath, newReadMe);
}

main();
