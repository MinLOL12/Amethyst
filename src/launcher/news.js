const { NEWS_URL } = require('../config');
const { fetchJson } = require('./downloader');

async function getNews() {
  try {
    const raw = await fetchJson(NEWS_URL, 'Minecraft launcher news');
    const entries = raw.entries || raw.article_grid || raw.news || [];
    return entries.slice(0, 8).map((item) => ({
      title: item.title || item.default_tile?.title || item.name || 'Minecraft News',
      category: item.category || item.type || 'News',
      date: item.date || item.publish_date || item.newsPageDate || '',
      url: item.url || item.read_more_link || item.news_page_url || 'https://www.minecraft.net/',
      excerpt: item.text || item.default_tile?.sub_header || item.subtitle || item.description || ''
    }));
  } catch (error) {
    return [
      {
        title: 'Welcome to Amethyst',
        category: 'Launcher',
        date: new Date().toISOString().slice(0, 10),
        url: 'https://www.minecraft.net/',
        excerpt: `Could not load live news right now (${error.message}). The launcher still works offline for saved versions and settings.`
      }
    ];
  }
}

module.exports = { getNews };
