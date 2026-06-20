# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@iobroker/ws-server-library` is a **library**, not a runnable adapter. It exports server-side classes that ioBroker WEB adapters (e.g. `ioBroker.ws`, `web`, `admin`) embed to expose ioBroker's object/state API to browser clients over WebSockets. There is no runtime entry point (no `main.ts`); `src/index.ts` only re-exports the public API.

The transport simulates the socket.io protocol over **pure WebSockets** — the socket.io library itself is not used (since v4). Browser clients connect with `@iobroker/ws`.

## Two similarly-named packages (read this first)

This package is `@iobroker/ws-server-**library**`. It depends on `@iobroker/ws-server` — a *different* package: the low-level pure-WebSocket transport. (An earlier draft named this package `@iobroker/ws-server` too, which collided with the dependency; that has been renamed.)

So `import ... from '@iobroker/ws-server'` inside `src/` resolves to the **transport dependency**, not to this repo's own code. From it the code pulls:
- `SocketIO` — the WebSocket *server* (named `WebSocketServer` in `socket.ts`)
- `Socket` — a single client *connection* (named `WebSocketClient` in `socketWS.ts`/`index.ts`)

## Architecture

Three layers, inner to outer:

1. **`@iobroker/ws-server` (dependency)** — raw WebSocket transport that mimics socket.io framing. Provides `SocketIO` (server) and `Socket` (connection).
2. **`@iobroker/socket-classes` (dependency)** — `SocketCommon`, the protocol/method engine shared by both the socket.io and ws adapters (implements all the [web methods](https://github.com/ioBroker/ioBroker.socket-classes#web-methods)), plus auth helpers (`passportSocket`), `Store`, whitelist logic, and shared types.
3. **This package** — thin glue between the two:
   - `src/lib/socketWS.ts` — `SocketWS extends SocketCommon`. Fills in the WS-specific abstract pieces: passport/cookie authentication (`__initAuthentication`), session lifetime + re-auth handling (`__getSessionID`, session-expiry timer), and broadcast helpers (`publishAll`, `publishFileAll`, `publishInstanceMessageAll`).
   - `src/lib/socket.ts` — `Socket` (exported as **`IOSocketClass`**). The high-level orchestrator a host adapter instantiates: given an `http(s).Server`, settings, the `ioBroker.Adapter`, a session `Store`, and an optional `checkUser` callback, it creates a `SocketWS` and starts it on the server. Surfaces `publish*`, `sendLog`, and `close`.
   - `src/index.ts` — re-exports `SocketWS`, `IOSocketClass`, `WebSocketClient`, and the `WsConfig` type.
   - `src/types.d.ts` — `WsConfig`, the adapter's `native` config shape (port, auth, secure, TLS certs, ttl, etc.). It is a hand-written `.d.ts`, so `tsc` does not emit it; `tasks.mts` copies it to `build/types.d.ts` after compilation.

When changing behavior, first check whether the logic belongs in `SocketCommon` (shared, in the `socket-classes` dependency) or is genuinely WS-specific (here). Most protocol behavior lives upstream in `socket-classes`.

`io-package.json` describes the consuming `ws` adapter (admin UI config, default `native`, instance objects) — useful as the contract for `WsConfig`, but this repo does not run as that adapter and the file is **not** published (`files` is `build/` + `LICENSE`).

## Commands

```bash
npm run build      # tsc -p tsconfig.build.json, then `node tasks.mts`
npm run lint       # eslint -c eslint.config.mjs
npm test           # alias for test:integration (mocha --exit)
npm run test:package      # mocha test/testPackage.js --exit
```

Run a single mocha test file: `npx mocha <path> --exit` (add `--grep "<name>"` to filter).

`tasks.mts` runs after `tsc`: it writes the bundled `@iobroker/ws` browser client to `build/lib/socket.io.js` (exposed via the `./socket.io.js` package export) and copies `src/types.d.ts` to `build/types.d.ts`. Build output goes to `build/` (gitignored). Note: there is currently no `test/` directory — the `test:*` scripts are inherited from the adapter and have nothing to run yet.

## Conventions

- **ESM + Node16 module resolution**, TypeScript `strict`, target ES2022. Node.js **>= 20** required.
- `tsconfig.json` only type-checks (`noEmit`, also checks JS); `tsconfig.build.json` is the one that emits and excludes JS.
- Lint and config come from `@iobroker/eslint-config` (includes prettier); `jsdoc/require-jsdoc` and `jsdoc/require-param` are intentionally disabled.
- Private members use the `#` syntax; adapter config is accessed as `this.adapter.config as WsConfig`.

## Release

Uses `@alcalzone/release-script` (`.releaseconfig.json`) with the iobroker + license plugins; it runs `npm run lint` and `npm run build` before committing.

```bash
npm run release-patch   # or release-minor / release-major
```

Keep `package.json`, `io-package.json` (`common.version`), and the README changelog versions in sync. CI (`.github/workflows/test-and-release.yml`) lints/tests on every push and PR, and publishes to npm only on `v*` tags.
