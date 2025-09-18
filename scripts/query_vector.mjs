#!/usr/bin/env node
// backend/scripts/query_vector.mjs
// Usage: node scripts/query_vector.mjs "your question here"

import 'dotenv/config';
import vc from '../src/services/vectorClient.mjs';

const query = process.argv.slice(2).join(' ').trim() || 'test query';

(async () => {
  try {
    console.log('🔍 Query:', query);
    const hits = await vc.search(query, 5);
    console.log('✅ Retrieved docs:', JSON.stringify(hits, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error running vector query:', err);
    process.exit(1);
  }
})();
