# Halo

Halo is a hybrid iOS and Android prototype for a private circle, an OpenStreetMap-based map, encrypted chat, quick bipper messages, and a press-and-hold safety confirmation. The user interface is in French. Code comments and technical documentation are in English.

## Current state

The web and Capacitor interface still uses a local Node API. It is **not yet a Telegram client**. The Telegram migration is in [`telegram/README.md`](telegram/README.md), with native TDLib bridges and a preparatory sign-in screen. The Telegram Serverless bot cannot be deployed until waitlist access is granted. Android and iOS builds also need TDLib binaries and Telegram application credentials. The existing interface should be treated as a prototype, not a dependable personal safety service.

The local API stores accounts and encrypted messages in `server/data.json`. It keeps only the latest encrypted position for each sender/recipient pair in `server/data.json.locations.sqlite`; the previous seven-day location history is removed and migrated to one latest point per pair. These data files are ignored by Git.

## Run locally

Use Node.js 24 or later for its built-in SQLite support.

```powershell
npm install
npm run server
```

In another terminal, run `npm run dev` and open `http://localhost:5173`. Select **Explorer la démo** for fictional contacts and locations. To test two local accounts, use separate browser profiles.

The native projects are in `android/` and `ios/`. Run `npm run sync` before opening them in Android Studio or Xcode. iOS builds require a Mac with Xcode. The local Node prototype requires a public HTTPS API address in a native build; the intended Telegram version will remove that dependency after integration.

## Current prototype behavior

Contacts must accept invitations before exchanging data. Messages, bipper signals, and coordinates are encrypted on the device using TweetNaCl `box` before the local API receives them. On iOS and Android, private keys use platform secure storage. Browser storage is only for development and demos. Encryption in this prototype is separate from the planned TDLib Secret Chats.

The location setting offers continuous sharing, sharing when the app opens, or scheduled sharing from 15 seconds to 12 hours. The latest encrypted position replaces the previous one. Stopping a share requests its deletion. If the device is offline, the app retries the deletion later; an approved contact may still access the last point until it expires. Background timing depends on operating-system permissions and scheduling and has not been validated on real devices.

The **Je vais bien** control requires a continuous press for 2, 3, or 5 seconds, with 3 seconds as the default. A missed check-in creates an in-app alert after the selected interval plus a two-hour grace period. There are no push notifications, calls, or SMS alerts.

## Map and assets

The map uses [OpenStreetMap](https://www.openstreetmap.org/copyright) data through [OpenFreeMap](https://openfreemap.org/quick_start/) and [MapLibre](https://maplibre.org/). Its local style approximates the supplied Apple Maps color references. The supplied blue SVG gradient appears behind the user's avatar. The supplied SF Pro Rounded font is included for this private prototype; review its license before wider distribution. Plan for suitable tile hosting at scale.

## Checks

Run `npm run build`, `npm run test:server`, and `node --test telegram/test/protocol.test.mjs` with Node.js 24 or later.
