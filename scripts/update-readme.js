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

async function main() {
  const videos = await getVideos(
    'https://www.youtube.com/feeds/videos.xml?playlist_id=PLcR4ZgxWXeICy2QVTV-6HuEHfl9DcAuq7'
  );
  const videosMarkups = generateVideosMarkup(videos);

  const template = await getTemplate();

  const newReadMe = template.replace(
    VIDEO_MARKER_FINDER,
    START_VIDEO_LIST_MARKER + videosMarkups + END_VIDEO_LIST_MARKER
  );

  await saveReadMe(newReadMe);
}

function generateVideosMarkup(videos) {
  let markup = '<aside>';

  for (const video of videos) {
    const {link, thumbnail, title} = video;
    const videoId = link.split('v=')[1];

    markup += `<a href="${link}" title="${title}"><img src="https://img.youtube.com/vi/${videoId}/maxresdefault.jpg" alt="${title}" width="400" height="226" /></a>&nbsp;&nbsp;`;
  }

  markup += '</aside>';

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
async function getVideos(videoFeedUrl, numberOfVideos = 8) {
  const parser = new Parser({
    customFields: {
      item: ['media:group', 'media:thumbnail'],
    },
  });

  const feed = await parser.parseURL(videoFeedUrl);

  return feed.items.slice(0, numberOfVideos).map((m) => {
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
