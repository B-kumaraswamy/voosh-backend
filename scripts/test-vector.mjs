// scripts/test-vector.mjs
import vectorClient from '../src/services/vectorClient.js';

async function run() {
  // Insert sample chunks
  await vectorClient.upsert([
    { text: 'The sun rises in the east.', title: 'Fact A' },
    { text: 'The capital of France is Paris.', title: 'Fact B' },
    { text: 'Football is played with a round ball.', title: 'Fact C' },
  ]);

  // Count vectors
  const count = await vectorClient.countVectors();
  console.log('Vector count:', count);

  // Search
  const hits = await vectorClient.search('Where does the sun rise?', 2);
  console.log('Search results:', hits);
}

run().catch((e) => console.error(e));
