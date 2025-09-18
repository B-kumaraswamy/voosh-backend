// scripts/test-sessionstore.mjs
import sessionStore from '../src/services/sessionStore.js';

async function run() {
  const sid = 'local-test-session';
  await sessionStore.resetSession(sid); // ensure clean
  await sessionStore.appendMessage(sid, { role: 'user', text: 'Hello' });
  await sessionStore.appendMessage(sid, { role: 'assistant', text: 'Hi there' });
  const msgs = await sessionStore.getMessages(sid, 10);
  console.log('messages:', msgs);
  const exists = await sessionStore.hasSession(sid);
  console.log('exists?', exists);
  await sessionStore.resetSession(sid);
  await sessionStore.close();
}
run().catch(err => { console.error(err); process.exit(1); });
