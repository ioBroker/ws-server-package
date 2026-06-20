# @iobroker/ws-server-library

Server-side library that exposes the ioBroker object/state API to browser clients over **pure WebSockets**.

This package is used by WEB applications and adapters to communicate with ioBroker using websockets.

It was extracted from the `ioBroker.ws` adapter so the same socket implementation can be shared by `ioBroker.web` and `ioBroker.ws` (and other WEB adapters).

It behaves almost like `ioBroker.socketio`, but does not use the `socket.io` library — since v4 the socket.io protocol is only *simulated* over native WebSockets.

> This is a **library**, not an adapter. End users do not install it directly; it is a dependency of the WEB adapters listed above.

You can find in the example [directory](https://github.com/ioBroker/ioBroker.ws/tree/master/example) a simple application that uses this interface to show some data.

## Usage

The library is consumed from inside an ioBroker adapter, after an HTTP(S) server and a session store already exist. The high-level entry point is `IOSocketClass`:

```ts
import { IOSocketClass } from '@iobroker/ws-server-library';
import type { SocketSettings, Store } from '@iobroker/socket-classes';

const io = new IOSocketClass(
    server,    // http.Server | https.Server the adapter already listens on
    settings,  // SocketSettings (from @iobroker/socket-classes)
    adapter,   // ioBroker.Adapter instance
    store,     // session Store (from @iobroker/socket-classes)
    checkUser, // optional (user, pass, cb) => void credential check
);

// broadcast to all connected clients
io.publishAll('stateChange', id, state);
io.publishFileAll(id, fileName, size);
io.sendLog(logMessage);

// on adapter unload
io.close();
```

The supported client-facing methods (the actual WebSocket protocol) are implemented in [`@iobroker/socket-classes`](https://github.com/ioBroker/ioBroker.socket-classes#web-methods). For the browser side use the [socket client](https://github.com/ioBroker/socket-client).

### Exports

| Export | Description |
|---|---|
| `IOSocketClass` | High-level wrapper an adapter instantiates (see above). |
| `SocketWS` | The `SocketCommon` subclass that implements the WS-specific auth, sessions and broadcasting. Use directly only for advanced cases. |
| `WebSocketClient` | Type of a single client connection (re-exported from the `@iobroker/ws-server` transport). |
| `WsConfig` | Type of the adapter `native` configuration (port, auth, secure, TLS certs, …). |
| `./socket.io.js` | The bundled `@iobroker/ws` browser client, so the consuming adapter can serve it to browsers. |

## ioBroker concepts

By using this interface you should understand the [basics and concept](https://github.com/ioBroker/ioBroker) of the system, and the [structure of the objects](https://github.com/ioBroker/ioBroker/blob/master/doc/SCHEMA.md).

### Object
An object is the description of a data point or a group. A group that contains other data points is a *channel*; a group of channels is a *device*. Objects are meta-information (min/max, unit, name, default value, value type, communication info, …).

### State
A state is the actual value of a data point:
```js
const state = {
    "val": VALUE,
    "ack": ACKNOWLEDGED,
    "ts": TIMESTAMP,                 // new Date(state.ts)
    "lc": TIMESTAMP_of_last_change,
    "from": ADAPTER_NAME,
    "q": QUALITY
};
```
States change far more frequently than objects (objects are normally written once, at creation).

### Acknowledgment
Every state has an `ack` flag that shows the direction of the command:
- `ack=false` — some adapter *wants to control* (write) the value, so the command will be executed (e.g. light will be switched on).
- `ack=true` — the device *informs* about a new value (e.g. light was switched on manually, or motion was detected).

### Quality
Every data point has a `q` (quality) attribute.

<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->

## Changelog
### 5.0.1 (2026-06-20)
* (@GermanBluefox) Initial commit. Extracted the socket implementation from the `ioBroker.ws` adapter into a shared library

## License
The MIT License (MIT)

Copyright (c) 2014-2026 @GermanBluefox <dogafox@gmail.com>
