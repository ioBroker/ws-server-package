import { Socket as WebSocketClient } from '@iobroker/ws-server';
import { SocketWS } from './lib/socketWS';
import { Socket as IOSocketClass } from './lib/socket';
import type { WsConfig } from './types';

export { SocketWS, IOSocketClass, WebSocketClient, type WsConfig };
