import { api } from 'sdk';
import { processQuery } from '../lib/core.js';
import { store } from '../lib/store.js';

export default async function (inlineQuery) {
  let response;
  try {
    response = await processQuery(inlineQuery.query, inlineQuery.from.id, store);
  } catch (error) {
    console.error('Halo inline query failed', error);
    response = 'H1:err:temporary';
  }
  // The article is returned to TDLib; Halo reads its description without
  // selecting/sending it into any Telegram chat.
  await api.answerInlineQuery({
    inline_query_id: inlineQuery.id,
    results: [{
      type: 'article',
      id: `halo-${inlineQuery.id}`.slice(0, 64),
      title: 'Halo',
      description: response,
      input_message_content: { message_text: 'Halo' },
    }],
    cache_time: 0,
    is_personal: true,
  });
}
