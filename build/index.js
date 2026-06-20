"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketClient = exports.IOSocketClass = exports.SocketWS = void 0;
const ws_server_1 = require("@iobroker/ws-server");
Object.defineProperty(exports, "WebSocketClient", { enumerable: true, get: function () { return ws_server_1.Socket; } });
const socketWS_1 = require("./lib/socketWS");
Object.defineProperty(exports, "SocketWS", { enumerable: true, get: function () { return socketWS_1.SocketWS; } });
const socket_1 = require("./lib/socket");
Object.defineProperty(exports, "IOSocketClass", { enumerable: true, get: function () { return socket_1.Socket; } });
//# sourceMappingURL=index.js.map