import { bipperPresets } from './protocol.mjs';

// The adapter must be connected to a TDLib client initialized with
// use_secret_chats=true. The UI must display the key hash for verification.
export async function requireReadySecretChat(tdlib, chatId, expectedUserId) {
  if (!Number.isSafeInteger(chatId) || chatId === 0 || !Number.isSafeInteger(expectedUserId) || expectedUserId <= 0) throw new Error('Invalid chat or contact.');
  const chat = await tdlib.send({ '@type': 'getChat', chat_id: chatId });
  if (chat?.type?.['@type'] !== 'chatTypeSecret' || chat.type.user_id !== expectedUserId) {
    throw new Error('This is not a Secret Chat with the selected contact.');
  }
  const secret = await tdlib.send({ '@type': 'getSecretChat', secret_chat_id: chat.type.secret_chat_id });
  if (secret?.state?.['@type'] !== 'secretChatStateReady') throw new Error('The Secret Chat is not ready.');
  return { chat, keyHash: secret.key_hash };
}

export async function sendSecretText(tdlib, chatId, expectedUserId, text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('Invalid message.');
  await requireReadySecretChat(tdlib, chatId, expectedUserId);
  return await tdlib.send({
    '@type': 'sendMessage', chat_id: chatId, topic_id: null, reply_to: null,
    options: null, reply_markup: null,
    input_message_content: {
      '@type': 'inputMessageText', text: { '@type': 'formattedText', text, entities: [] },
      link_preview_options: null, clear_draft: false,
    },
  });
}

export async function sendBipper(tdlib, recipients, preset) {
  if (!bipperPresets.includes(preset)) throw new Error('Unknown bipper message.');
  if (!Array.isArray(recipients) || !recipients.length) throw new Error('Choose at least one contact.');
  const results = await Promise.allSettled(recipients.map(({ chatId, userId }) => sendSecretText(tdlib, chatId, userId, preset)));
  return results.map((result, index) => ({ userId: recipients[index].userId, sent: result.status === 'fulfilled', error: result.status === 'rejected' ? String(result.reason) : undefined }));
}

export async function shareLocationKey(tdlib, recipients, epoch, key) {
  // Secret Chats provide the end-to-end encrypted transport. The key itself
  // is used only to encrypt position blobs later sent to the Serverless bot.
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(epoch) || !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Invalid sharing key.');
  return await Promise.allSettled(recipients.map(({ chatId, userId }) => sendSecretText(tdlib, chatId, userId, `HALO-LOCATION-KEY:1:${epoch}:${key}`)));
}

export async function receiveLocationKey(tdlib, chatId, expectedOwnerId, message) {
  await requireReadySecretChat(tdlib, chatId, expectedOwnerId);
  if (message?.sender_id?.['@type'] !== 'messageSenderUser' || message.sender_id.user_id !== expectedOwnerId) return null;
  const text = message?.content?.['@type'] === 'messageText' ? message.content.text?.text : null;
  if (typeof text !== 'string') return null;
  const match = /^HALO-LOCATION-KEY:1:([A-Za-z0-9_-]{8,32}):([A-Za-z0-9_-]{43})$/.exec(text);
  return match ? { ownerId: expectedOwnerId, epoch: match[1], key: match[2] } : null;
}
