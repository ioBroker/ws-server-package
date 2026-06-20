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

// Type of a single connected client connection, re-exported from the low-level transport.
import { Socket as WebSocketClient } from '@iobroker/ws-server';
// WS-specific `SocketCommon` implementation: authentication, session handling and broadcasting.
import { SocketWS } from './lib/socketWS';
// High-level wrapper an adapter instantiates. Aliased to `IOSocketClass` so it does not clash
// with the transport's own `Socket` (the per-client connection type above).
import { Socket as IOSocketClass } from './lib/socket';
// Shape of the adapter `native` configuration (port, auth, TLS certs, …).
import type { WsConfig } from './types';

export { SocketWS, IOSocketClass, WebSocketClient, type WsConfig };
