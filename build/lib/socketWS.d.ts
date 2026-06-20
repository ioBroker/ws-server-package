import { SocketCommon, type Store, type SocketSubscribeTypes } from '@iobroker/socket-classes';
import type { Socket as WebSocketClient } from '@iobroker/ws-server';
/**
 * WebSocket-specific implementation of the shared `SocketCommon` protocol engine.
 *
 * `SocketCommon` (from `@iobroker/socket-classes`) contains all the transport-agnostic logic that is
 * identical for the socket.io and the pure-WebSocket adapters: subscriptions, the "web methods",
 * permission checks, etc. The few pieces that depend on *how* clients connect are declared abstract /
 * overridable there and implemented here. By convention those framework hooks are prefixed with `__`
 * and are called by the base class — they are not meant to be called by application code.
 *
 * Only `secure`, `auth` and `crossDomain` of the adapter settings are relevant for this subclass.
 */
export declare class SocketWS extends SocketCommon {
    #private;
    /**
     * Hook for the base class: tells it that this transport keeps unauthenticated sockets open instead
     * of dropping them. We re-authenticate in place (see {@link SocketWS.#onAuthorizeFail}) rather than
     * disconnecting, so the base class must not force a disconnect.
     *
     * @returns Always `true` for the pure-WebSocket transport.
     */
    __getIsNoDisconnect(): boolean;
    /**
     * Hook for the base class: install the authentication middleware on the socket server.
     *
     * Keeps the session store in sync between the passed options and the instance (whichever side has
     * it wins), then registers the passport-based cookie/session check — unless the deployment uses
     * OAuth2 exclusively, in which case no cookie middleware is needed.
     *
     * @param authOptions Authentication configuration.
     * @param authOptions.store The session store used to look up the session referenced by the cookie.
     * @param authOptions.secret Secret used to parse/verify the signed session cookie.
     * @param authOptions.oauth2Only When `true`, skip the cookie/passport middleware entirely.
     * @param authOptions.checkUser Optional username/password verification callback.
     */
    __initAuthentication(authOptions: {
        store: Store;
        secret?: string;
        oauth2Only?: boolean;
        checkUser?: (user: string, pass: string, cb: (error: Error | null, result?: {
            logged_in: boolean;
            user?: string;
        }) => void) => void;
    }): void;
    /**
     * Hook for the base class: return the session id associated with a socket.
     *
     * When authentication is disabled in the adapter config there is no session, so `null` is returned
     * and the base class skips all session-bound bookkeeping.
     *
     * @param socket The client connection.
     * @returns The session id, or `null` when auth is off or the socket has none.
     */
    __getSessionID(socket: WebSocketClient): string | null;
    /**
     * Broadcast an object/state change to all connected clients (each `publish` performs the
     * per-socket subscription check, so only interested clients actually receive it).
     *
     * @param type The subscription type that changed.
     * @param id The id of the changed object/state.
     * @param obj The new value, or `null`/`undefined` if it was deleted.
     */
    publishAll(type: SocketSubscribeTypes, id: string, obj: ioBroker.Object | ioBroker.State | null | undefined): void;
    /**
     * Broadcast a file change to all connected clients. When a client is actually notified, its session
     * is refreshed via `__updateSession` so active file watchers keep their session alive.
     *
     * @param id The id of the object the file belongs to.
     * @param fileName The name of the changed file.
     * @param size The new file size in bytes, or `null` if deleted.
     */
    publishFileAll(id: string, fileName: string, size: number | null): void;
    /**
     * Deliver an instance message to the single client whose socket id matches `sid`.
     *
     * @param sourceInstance The instance that produced the message.
     * @param messageType Application-defined message type.
     * @param sid The target socket id.
     * @param data The message payload (object or array).
     */
    publishInstanceMessageAll(sourceInstance: string, messageType: string, sid: string, data: any): void;
}
