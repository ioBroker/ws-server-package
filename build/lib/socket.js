"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Socket = void 0;
const ws_server_1 = require("@iobroker/ws-server");
const socketWS_1 = require("./socketWS");
const socket_classes_1 = require("@iobroker/socket-classes");
/**
 * High-level entry point of the library.
 *
 * `Socket` (exported as `IOSocketClass`) is the object an ioBroker adapter creates once during
 * startup. It is a thin facade that:
 *  1. instantiates the WS-specific protocol handler ({@link SocketWS}), and
 *  2. attaches it to the adapter's existing HTTP(S) server using the low-level WebSocket transport.
 *
 * After construction the adapter only talks to this facade: it pushes updates to all clients via the
 * `publish*` methods, forwards log messages via {@link Socket.sendLog}, and tears everything down via
 * {@link Socket.close} on unload. The actual client-facing protocol (the supported "web methods") lives
 * in `@iobroker/socket-classes` and is reused unchanged.
 */
class Socket {
    /** The running protocol handler, or `null` once {@link Socket.close} has been called. */
    ioServer;
    /**
     * Create the socket server and immediately start listening on the given HTTP(S) server.
     *
     * @param server The HTTP(S) server the adapter already created; the socket server hooks into it.
     * @param settings Socket settings (auth, secure, secret, whitelist, …) coming from the adapter config.
     * @param adapter The ioBroker adapter instance, used for logging and object/state access.
     * @param store The session store used to validate the session cookie sent by the browser.
     *  Must be a real (persistent) store — a memory store will not work across processes.
     * @param checkUser Optional credential check for username/password logins. Receives the
     *  credentials and a node-style callback that reports whether the login succeeded.
     */
    constructor(server, settings, adapter, store, checkUser) {
        // Build the protocol handler and wire it onto the HTTP(S) server. `WebSocketServer` is the
        // low-level transport (the socket.io simulation); `SocketWS.start` performs the binding and
        // installs the authentication middleware via the provided store/secret/checkUser.
        this.ioServer = new socketWS_1.SocketWS(settings, adapter);
        this.ioServer.start(server, ws_server_1.SocketIO, {
            checkUser,
            store,
            secret: settings.secret,
        });
    }
    /**
     * Resolve the configured access entry for a remote IP against the whitelist.
     *
     * Delegates to the shared implementation in `SocketCommon` so the matching logic is identical
     * across all WEB adapters.
     *
     * @param remoteIp The remote address of the incoming connection.
     * @param whiteListSettings The whitelist keyed by address (and/or `default`).
     * @returns The matched whitelist key, or `null` when no entry applies.
     */
    getWhiteListIpForAddress(remoteIp, whiteListSettings) {
        return socket_classes_1.SocketCommon.getWhiteListIpForAddress(remoteIp, whiteListSettings);
    }
    /**
     * Broadcast an object or state change to every connected client that is subscribed to it.
     *
     * @param type The subscription type that changed (e.g. state or object change).
     * @param id The id of the changed object/state.
     * @param obj The new value, or `null`/`undefined` when the object/state was deleted.
     */
    publishAll(type, id, obj) {
        return this.ioServer?.publishAll(type, id, obj);
    }
    /**
     * Broadcast a change of a binary/meta file to every subscribed client.
     *
     * @param id The id of the object the file belongs to.
     * @param fileName The name of the changed file.
     * @param size The new file size in bytes, or `null` when the file was deleted.
     */
    publishFileAll(id, fileName, size) {
        return this.ioServer?.publishFileAll(id, fileName, size);
    }
    /**
     * Deliver an instance-to-instance message to the single client identified by its socket id.
     *
     * @param sourceInstance The instance that sent the message (e.g. `admin.0`).
     * @param messageType Application-defined message type.
     * @param sid The target socket id; only the matching client receives the message.
     * @param data The message payload (object or array).
     */
    publishInstanceMessageAll(sourceInstance, messageType, sid, data) {
        return this.ioServer?.publishInstanceMessageAll(sourceInstance, messageType, sid, data);
    }
    /**
     * Forward an ioBroker log message to the clients that subscribed to the log stream.
     *
     * @param obj The log message emitted by the controller.
     */
    sendLog(obj) {
        this.ioServer?.sendLog(obj);
    }
    /**
     * Stop the socket server and release the reference. Safe to call multiple times; subsequent
     * `publish*`/`sendLog` calls become no-ops because {@link Socket.ioServer} is then `null`.
     */
    close() {
        if (this.ioServer) {
            this.ioServer.close();
            this.ioServer = null;
        }
    }
}
exports.Socket = Socket;
//# sourceMappingURL=socket.js.map