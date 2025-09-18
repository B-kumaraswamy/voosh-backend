// scripts/test-feeds.mjs
import RSSParser from 'rss-parser';
import fs from 'fs/promises';
import fetch from 'node-fetch';

const parser = new RSSParser();

async function sanitizeAndParse(feedUrl) {
  try {
    const resp = await fetch(feedUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }});
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    let xml = await resp.text();
    xml = xml.replace(/&(?![a-zA-Z]+;|#\d+;|#x[a-fA-F0-9]+;)/g, '&amp;');
    const feed = await parser.parseString(xml);
    return (feed.items || []).slice(0, 5).map(i => ({ title: i.title, link: i.link }));
  } catch (e) {
    return { error: String(e) };
  }
}

(async () => {
  const feedsText = await fs.readFile('src/ingest/feeds.txt', 'utf8');
  const feeds = feedsText.split('\n').map(s => s.trim()).filter(Boolean);
  for (const f of feeds) {
    const r = await sanitizeAndParse(f);
    console.log('FEED:', f);
    console.log(JSON.stringify(r, null, 2));
    console.log('---');
  }
})();
