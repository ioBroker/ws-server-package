"use strict";
/**
 * Public entry point of `@iobroker/ws-server-library`.
 *
 * This barrel re-exports everything a consuming ioBroker WEB adapter
 * (`ioBroker.web`, `ioBroker.ws`, …) needs in order to expose the ioBroker
 * object/state API to browser clients over **pure WebSockets** (the socket.io
 * protocol is only simulated, the socket.io library itself is not used).
 *
 * Typical usage from inside an adapter:
 * ```ts
 * import { IOSocketClass } from '@iobroker/ws-server-library';
 * const io = new IOSocketClass(server, settings, adapter, store, checkUser);
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketClient = exports.IOSocketClass = exports.SocketWS = void 0;
// Type of a single connected client connection, re-exported from the low-level transport.
const ws_server_1 = require("@iobroker/ws-server");
Object.defineProperty(exports, "WebSocketClient", { enumerable: true, get: function () { return ws_server_1.Socket; } });
// WS-specific `SocketCommon` implementation: authentication, session handling and broadcasting.
const socketWS_1 = require("./lib/socketWS");
Object.defineProperty(exports, "SocketWS", { enumerable: true, get: function () { return socketWS_1.SocketWS; } });
// High-level wrapper an adapter instantiates. Aliased to `IOSocketClass` so it does not clash
// with the transport's own `Socket` (the per-client connection type above).
const socket_1 = require("./lib/socket");
Object.defineProperty(exports, "IOSocketClass", { enumerable: true, get: function () { return socket_1.Socket; } });
//# sourceMappingURL=index.js.map