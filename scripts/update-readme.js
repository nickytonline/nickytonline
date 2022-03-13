const Parser = require('rss-parser');
const fs = require('fs/promises');
const path = require('path');
const readmeFilePath = path.resolve(__dirname, '../README.md');

const START_VIDEO_LIST_MARKER = '<!-- VIDEO-LIST:START -->';
const END_VIDEO_LIST_MARKER = '<!-- VIDEO-LIST:END -->';
const VIDEO_MARKER_FINDER = new RegExp(
  START_VIDEO_LIST_MARKER + '(.|[\r\n])*?' + END_VIDEO_LIST_MARKER
);

async function main() {
  const videos = await getVideos();
  const videosMarkups = generateVideosMarkup(videos);

  const template = await getTemplate();

  const newReadMe = template.replace(
    VIDEO_MARKER_FINDER,
    START_VIDEO_LIST_MARKER + videosMarkups + END_VIDEO_LIST_MARKER
  );

  await saveReadMe(newReadMe);
}

function generateVideosMarkup(videos) {
  let markup = '<table border="0"><tbody>';

  for (const video of videos) {
    const {link, thumbnail, title} = video;

    markup += `<td align="center" valign="center"><img src="${thumbnail}" alt="${title}" width="240" height="180" /></a></td>`;
  }

  markup += '</tbody></table>';

  return markup;
}

/**
 * Example data object:
 * [
 * {
 *    title: String,
 *    link: String,
 *    date: Date,
 *    description: String,
 *    thumbnail: String
 *  }
 * ]
 */
async function getVideos() {
  const parser = new Parser({
    customFields: {
      item: ['media:group', 'media:thumbnail'],
    },
  });

  const feed = await parser.parseURL(
    `https://www.youtube.com/feeds/videos.xml?channel_id=UCBLlEq0co24VFJIMEHNcPOQ`
  );

  return feed.items.slice(0, 3).map((m) => {
    return {
      title: m.title,
      link: m.link,
      description: m['media:group']['media:description'][0],
      thumbnail: m['media:group']['media:thumbnail'][0].$.url,
      date: m.pubDate ? new Date(m.pubDate) : new Date(),
    };
  });
}

async function getTemplate() {
  return await fs.readFile(readmeFilePath, 'utf-8');
}

async function saveReadMe(newReadMe) {
  await fs.writeFile(readmeFilePath, newReadMe);
}

main();