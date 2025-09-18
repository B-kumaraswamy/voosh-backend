import winkLemmatizer from "wink-lemmatizer";
import posTagger from "wink-pos-tagger";
import { removeStopwords } from "stopword";
import pkg from 'natural';
const { WordTokenizer } = pkg
const tagger = posTagger();
const tokenizer = new WordTokenizer(); // simple word tokenizer

/**
 * Map wink-pos tags to general categories for lemmatizer
 * The tagger returns tags similar to 'NN', 'VB', etc.
 */
function tagToCategory(tag) {
  if (!tag) return null;
  if (/^VB/.test(tag)) return "verb";
  if (/^NN/.test(tag)) return "noun";
  if (/^JJ/.test(tag)) return "adjective";
  if (/^RB/.test(tag)) return "adverb";
  return null;
}

export function lemmatizeDocumentsWithWink(docs, opts = {}) {
  const { lowercase = true, preserveStopwords = false } = opts;
  const lemmaCache = new Map();

  function lemmaForToken(tok, cat) {
    const key = `${tok}|${cat}`;
    if (lemmaCache.has(key)) return lemmaCache.get(key);

    let lemma = tok;
    try {
      if (cat === "verb") lemma = winkLemmatizer.verb(tok) || tok;
      else if (cat === "noun") lemma = winkLemmatizer.noun(tok) || tok;
      else if (cat === "adjective") lemma = winkLemmatizer.adjective(tok) || tok;
      else if (cat === "adverb") lemma = winkLemmatizer.adverb(tok) || tok;
      else lemma = tok;
    } catch (e) {
      lemma = tok;
    }
    lemmaCache.set(key, lemma);
    return lemma;
  }

  return docs.map((doc) => {
    const raw = doc.pageContent || "";
    const text = lowercase ? raw.toLowerCase() : raw;
    const tokens = tokenizer.tokenize(text); // token array
    const tags = tagger.tagSentence(tokens.join(" ")); // returns array of { value, tag }

    // Map tokens to lemmas using POS tags
    const lemmas = tags.map(({ value, tag }) => {
      const cat = tagToCategory(tag);
      return lemmaForToken(value, cat);
    });

    const tokensFiltered = lemmas.map(s => s && s.trim()).filter(Boolean);
    const finalTokens = preserveStopwords ? tokensFiltered : removeStopwords(tokensFiltered);
    const processedText = finalTokens.join(" ");

    return {
      ...doc,
      metadata: {
        ...doc.metadata,
        processedText,
        lemmaCount: finalTokens.length,
        lemmaCacheSize: lemmaCache.size,
      },
    };
  });
}
