import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';

import { SocketIO as WebSocketServer } from '@iobroker/ws-server';
import { SocketWS } from './socketWS';
import {
    type Store,
    SocketCommon,
    type WhiteListSettings,
    type SocketSubscribeTypes,
    type SocketSettings,
} from '@iobroker/socket-classes';

/** Either a plain HTTP or a TLS HTTP server the adapter already listens on. */
type Server = HttpServer | HttpsServer;

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
export class Socket {
    /** The running protocol handler, or `null` once {@link Socket.close} has been called. */
    public ioServer: SocketWS | null;

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
    constructor(
        server: Server,
        settings: SocketSettings,
        adapter: ioBroker.Adapter,
        store: Store,
        checkUser?: (
            user: string,
            pass: string,
            cb: (
                error: Error | null,
                result?: {
                    logged_in: boolean;
                    user?: string;
                },
            ) => void,
        ) => void,
    ) {
        // Build the protocol handler and wire it onto the HTTP(S) server. `WebSocketServer` is the
        // low-level transport (the socket.io simulation); `SocketWS.start` performs the binding and
        // installs the authentication middleware via the provided store/secret/checkUser.
        this.ioServer = new SocketWS(settings, adapter);
        this.ioServer.start(server, WebSocketServer, {
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
    getWhiteListIpForAddress(
        remoteIp: string,
        whiteListSettings: {
            [address: string]: WhiteListSettings;
        },
    ): string | null {
        return SocketCommon.getWhiteListIpForAddress(remoteIp, whiteListSettings);
    }

    /**
     * Broadcast an object or state change to every connected client that is subscribed to it.
     *
     * @param type The subscription type that changed (e.g. state or object change).
     * @param id The id of the changed object/state.
     * @param obj The new value, or `null`/`undefined` when the object/state was deleted.
     */
    publishAll(type: SocketSubscribeTypes, id: string, obj: ioBroker.Object | ioBroker.State | null | undefined): void {
        return this.ioServer?.publishAll(type, id, obj);
    }

    /**
     * Broadcast a change of a binary/meta file to every subscribed client.
     *
     * @param id The id of the object the file belongs to.
     * @param fileName The name of the changed file.
     * @param size The new file size in bytes, or `null` when the file was deleted.
     */
    publishFileAll(id: string, fileName: string, size: number | null): void {
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
    publishInstanceMessageAll(sourceInstance: string, messageType: string, sid: string, data: any): void {
        return this.ioServer?.publishInstanceMessageAll(sourceInstance, messageType, sid, data);
    }

    /**
     * Forward an ioBroker log message to the clients that subscribed to the log stream.
     *
     * @param obj The log message emitted by the controller.
     */
    sendLog(obj: ioBroker.LogMessage): void {
        this.ioServer?.sendLog(obj);
    }

    /**
     * Stop the socket server and release the reference. Safe to call multiple times; subsequent
     * `publish*`/`sendLog` calls become no-ops because {@link Socket.ioServer} is then `null`.
     */
    close(): void {
        if (this.ioServer) {
            this.ioServer.close();
            this.ioServer = null;
        }
    }
}
