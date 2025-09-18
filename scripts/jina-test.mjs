import axios from 'axios';
console.log('Endpoint:', process.env.JINA_API_URL || 'https://api.jina.ai/v1/embeddings');
const url = process.env.JINA_API_URL || 'https://api.jina.ai/v1/embeddings';
const key = process.env.JINA_API_KEY;
(async () => {
  const resp = await axios.post(url, {
    model: process.env.JINA_EMBEDDING_MODEL || 'jina-embeddings-v3',
    input: ['hello world']
  }, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    validateStatus: () => true
  });
  console.log('status', resp.status);
  console.log('body:', JSON.stringify(resp.data, null, 2));
})();
