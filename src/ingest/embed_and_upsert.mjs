// src/ingest/embed_and_upsert.js
// Ingest articles into Qdrant using LangChain JS
// Usage:
//   node src/ingest/embed_and_upsert.js --sample
//   node src/ingest/embed_and_upsert.js --feeds src/ingest/feeds.txt --limit 50

import "dotenv/config";
import fs from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import pLimit from "p-limit";
import fetch from "node-fetch";

import { lemmatizeDocumentsWithWink } from "./lemmatize_quick.mjs";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

import vectorClient from "../services/vectorClient.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_CHUNK_SIZE = parseInt(process.env.INGEST_CHUNK_SIZE || "1200", 10);
const DEFAULT_CHUNK_OVERLAP = parseInt(
  process.env.INGEST_CHUNK_OVERLAP || "200",
  10
);
const CONCURRENCY = parseInt(process.env.INGEST_CONCURRENCY || "6", 10);

/** Ingest from local sample file */
async function ingestFromSample(
  samplePath = resolve(__dirname, "sample_articles.json")
) {
  const raw = await fs.readFile(samplePath, "utf-8");
  const articles = JSON.parse(raw);
  console.log(`Loaded ${articles.length} sample articles from`, samplePath);
  return articles.map((a) => ({
    title: a.title || null,
    url: a.url || null,
    publishedAt: a.publishedAt || null,
    text: a.text || a.content || "",
  }));
}

/** Read feeds.txt containing one URL per line */
async function readFeedsList(feedsPath = join(__dirname, "feeds.txt")) {
  const txt = await fs.readFile(feedsPath, "utf-8");
  return txt.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Fetch article links from feeds (basic fallback for now) * If the URL looks like an RSS feed, try parsing <link> entries.
 * If it’s a direct article URL, just keep it.
 */
async function fetchArticleUrlsFromFeeds(feedUrls = [], limit = 50) {
  const urls = [];

  for (const feedUrl of feedUrls) {
    if (feedUrl.endsWith(".xml") || feedUrl.includes("rss")) {
      // Treat as RSS feed
      try {
        const resp = await fetch(feedUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!resp.ok) {
          console.warn(`Feed fetch failed ${feedUrl}: ${resp.status}`);
          continue;
        }
        const xml = await resp.text();
        const matches = [...xml.matchAll(/<link>(.*?)<\/link>/g)];
        for (const m of matches) {
          const link = m[1];
          if (link && !link.includes("rss")) {
            urls.push({ link });
          }
          if (urls.length >= limit) break;
        }
      } catch (err) {
        console.warn("Feed error", feedUrl, err.message || err);
      }
    } else {
      // Treat as direct article URL
      urls.push({ link: feedUrl });
    }
    if (urls.length >= limit) break;
  }

  return urls.slice(0, limit);
}

/** Process one article using Cheerio loader + splitter */
async function processArticle(articleMeta) {
  const url = articleMeta.url || articleMeta.link;
  try {
    const loader = new CheerioWebBaseLoader(url, {
      selector: "h1, h2, h3, h4, h5, h6, p",
    });
    const docs = await loader.load();

    // lemmatize text
    const processedDocs = lemmatizeDocumentsWithWink(docs);

    // split into chunks
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: DEFAULT_CHUNK_SIZE,
      chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    });
    const splitDocs = await splitter.splitDocuments(processedDocs);

    return splitDocs.map((doc, idx) => ({
      id: uuidv4(),
      text: doc.metadata.processedText || doc.pageContent,
      title: articleMeta.title || doc.metadata.title || null,
      url,
      meta: { chunkIndex: idx },
    }));
  } catch (err) {
    console.warn("Failed to process article", url, err.message);
    return [];
  }
}

/** Upsert docs into Qdrant */
async function upsertDocs(docs, batchSize = 64) {
  let inserted = 0;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    await vectorClient.upsert(batch);
    inserted += batch.length;
  }
  return inserted;
}

/** Top-level ingestion */
export async function runIngest({
  sampleOnly = false,
  feedsFile = null,
  limit = 50,
} = {}) {
  const start = Date.now();
  const results = {
    articlesFetched: 0,
    articlesProcessed: 0,
    chunksInserted: 0,
    failures: [],
  };

  let articlesToProcess = [];

  if (sampleOnly) {
    articlesToProcess = await ingestFromSample();
  } else if (feedsFile) {
    const feedUrls = await readFeedsList(feedsFile);
    articlesToProcess = await fetchArticleUrlsFromFeeds(feedUrls, limit);
  } else {
    throw new Error("No source specified. Use --sample or --feeds <file>");
  }

  console.log("Total candidate articles:", articlesToProcess.length);

  const limiter = pLimit(CONCURRENCY);
  const tasks = articlesToProcess.map((a) =>
    limiter(async () => {
      results.articlesFetched += 1;
      const chunks = await processArticle(a);
      if (!chunks.length) {
        results.failures.push({ url: a.url || a.link, error: "no content" });
        return;
      }
      results.articlesProcessed += 1;
      const inserted = await upsertDocs(chunks);
      results.chunksInserted += inserted;
      console.log(
        `Inserted ${inserted} chunks for article ${chunks[0].title || chunks[0].url}`
      );
    })
  );

  await Promise.all(tasks);

  const elapsed = (Date.now() - start) / 1000;
  console.log("--- Ingest summary ---");
  console.log("Elapsed seconds:", elapsed);
  console.log("Articles fetched:", results.articlesFetched);
  console.log("Articles processed:", results.articlesProcessed);
  console.log("Chunks inserted:", results.chunksInserted);
  console.log("Failures:", results.failures.length);
  return results;
}

/** CLI */
async function cli() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--sample") opts.sampleOnly = true;
    else if (a === "--feeds") (opts.feedsFile = args[i + 1]), i++;
    else if (a === "--limit")
      (opts.limit = parseInt(args[i + 1] || "50", 10)), i++;
  }
  await runIngest(opts);
}

if (process.argv[1] && process.argv[1].endsWith('embed_and_upsert.mjs')) {
  cli();
}
