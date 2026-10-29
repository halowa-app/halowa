# Halo Telegram migration

Halo is intended to be a standalone iOS and Android client, not a Telegram Mini App. The existing Vite interface still talks to the local Node API. The files in this directory prepare its replacement; they are **not yet connected to the production interface**.

The Halo bot exists, but Telegram Serverless access is still waitlisted. The owner has not yet created an `api_id` and `api_hash` at `my.telegram.org`. No Serverless deployment or two-device integration test has taken place.

## Intended data flow

1. Each person signs into Telegram inside Halo through TDLib. An invitation and acceptance establish a contact. The owner separately approves access to their location.
2. Starting a share creates a random 256-bit location key and session. The key is sent to each selected contact in a TDLib Secret Chat. After that delivery, Halo sends an encrypted latest-position blob to the Serverless bot through an inline query. Updates replace the previous blob; the bot never receives plaintext coordinates.
3. When an approved contact opens the map, Halo asks the bot for the current encrypted blob through an inline query and decrypts it on the device. No position history is retained by this design.
4. Stopping a share deletes the blob and access grants. Revoking one contact requires rotating the location key before any further update.
5. Ordinary messages and press-and-hold bipper signals travel directly between devices in TDLib Secret Chats. The bot does not participate in these conversations.

## Implemented modules

- `tgcloud/`: proposed SQLite schema, authorization checks, atomic replacement of the latest position, and an inline-query handler.
- `client/protocol.mjs`: location encryption, compact bot commands, and parsing of inline results.
- `client/sharing.mjs`: ordering for key delivery, access grants, publication, and stopping a share.
- `client/secretChats.mjs`: Secret Chat readiness checks and message/key delivery helpers.
- `test/`: local tests for protocol behavior, encryption, stopping, and authorization.
- `../src/telegram/`: typed Capacitor bridge, TDLib database key in device secure storage, and a preparatory account sign-in screen.
- `../android/app/src/main/`: an Android Capacitor plugin and JNI wrapper for TDLib's JSON C API. It becomes available only when a compatible `libtdjson.so` is supplied.
- `../ios/App/App/`: an iOS Capacitor plugin that looks up TDLib's JSON C symbols. It becomes available only after a compatible signed TDLib framework or dylib is linked or bundled.

## Remaining integration

- Enable Serverless and inline mode for the bot, then deploy the schema and handler using the supported Telegram tooling after waitlist access is granted. The handler has not been tested against a live Serverless runtime.
- Obtain an application `api_id` and `api_hash` from `my.telegram.org`. Do not put the hash, bot token, database key, or private keys in Git.
- Build and package compatible TDLib binaries for Android and iOS. Validate both native bridges on real devices; iOS has not been compiled on this Windows machine. Complete the remaining account authorization states, contact approval flow, Secret Chat key verification, receiving and storing shared location keys, key rotation, and migration of the existing screens.
- Move background location publication into a native service. JavaScript in the WebView cannot guarantee delivery while iOS suspends the app. A 15-second interval is a target requiring real-device measurement, not a guarantee.
- Test inline-query size, rate limits, and delivery using two accounts and devices. Telegram documents inline results, but does not guarantee this use as a 15-second synchronization channel.

The former Node API remains a local prototype and is still required by the current interface. It now keeps only each contact pair's latest encrypted position.

## Local checks

Run `node --test test/protocol.test.mjs` from this directory. Run the root build and server tests from the repository root.
