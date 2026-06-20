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
import { Socket as WebSocketClient } from '@iobroker/ws-server';
import { SocketWS } from './lib/socketWS';
import { Socket as IOSocketClass } from './lib/socket';
import type { WsConfig } from './types';
export { SocketWS, IOSocketClass, WebSocketClient, type WsConfig };
