require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const Parser = require('rss-parser');
const readmeFilePath = path.resolve(__dirname, '../README.md');

const START_SCHEDULE_MARKER = '<!-- STREAM-SCHEDULE:START -->';
const END_SCHEDULE_MARKER = '<!-- STREAM-SCHEDULE:END -->';
const SCHEDULE_MARKER_FINDER = new RegExp(
  START_SCHEDULE_MARKER + '(.|[\r\n])*?' + END_SCHEDULE_MARKER
);

const FEED_URL = 'https://nickyt.live/feed';

async function main() {
  try {
    const streams = await getUpcomingStreams();
    const scheduleMarkup = await generateScheduleMarkup(streams);
    const template = await getTemplate();

    const newReadMe = template.replace(
      SCHEDULE_MARKER_FINDER,
      START_SCHEDULE_MARKER + scheduleMarkup + END_SCHEDULE_MARKER
    );

    await saveReadMe(newReadMe);
    console.log(`Updated README with ${streams.length} upcoming streams`);
  } catch (error) {
    console.error('Error updating stream schedule:', error);
  }
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

async function generateScheduleMarkup(streams) {
  if (streams.length === 0) {
    return '\n<p>No upcoming streams scheduled at the moment.</p>\n';
  }

  let markup = '<aside>';

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
      const videoId = stream.link?.split('v=')[1];
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
            const response = await fetch(url);
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
      markup += `<a href="${stream.link}" title="${title}"><img src="${thumbnailUrl}" alt="${title}" width="400" height="225" loading="lazy" /></a>&nbsp;&nbsp;`;
    }
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
