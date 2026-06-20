"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketWS = void 0;
const passport_1 = __importDefault(require("passport"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const socket_classes_1 = require("@iobroker/socket-classes");
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
class SocketWS extends socket_classes_1.SocketCommon {
    /**
     * Hook for the base class: tells it that this transport keeps unauthenticated sockets open instead
     * of dropping them. We re-authenticate in place (see {@link SocketWS.#onAuthorizeFail}) rather than
     * disconnecting, so the base class must not force a disconnect.
     *
     * @returns Always `true` for the pure-WebSocket transport.
     */
    __getIsNoDisconnect() {
        return true;
    }
    /**
     * Passport callback invoked when a connection was successfully authenticated.
     *
     * @param data The augmented HTTP request carrying the underlying socket/connection.
     * @param accept Continuation: call with `false` to accept the connection (no error).
     */
    #onAuthorizeSuccess = (data, accept) => {
        this.adapter.log.debug(`successful connection to socket.io from ${(data.socket || data.connection).remoteAddress}`);
        // no error
        accept(false);
    };
    /**
     * Passport callback invoked when authentication failed.
     *
     * Instead of silently rejecting, we ask the client to re-authenticate shortly after, then report
     * the error. `critical` failures (real auth errors) are logged at info level; non-critical ones
     * (e.g. an expired/missing session that the client can simply renew) are not.
     *
     * @param data The augmented HTTP request carrying the underlying socket/connection.
     * @param message Human-readable reason for the failure.
     * @param critical Whether this is a hard failure (vs. a renewable/soft one).
     * @param accept Continuation: called with an `Error` so the client receives a socket.io error package.
     */
    #onAuthorizeFail = (data, message, critical, accept) => {
        // Nudge the client to start a fresh authentication round (slightly delayed so the error below
        // is delivered first).
        setTimeout(() => data.socket.emit(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE), 100);
        if (critical) {
            this.adapter?.log.info(`failed connection to socket.io from ${(data.socket || data.connection).remoteAddress}: ${message}`);
        }
        // this error will be sent to the user as a special error-package
        // see: http://socket.io/docs/client-api/#socket > error-object
        // Note: `accept` is typed `(err: boolean)`, but the socket.io contract here expects an Error
        // object — hence the deliberate `@ts-expect-error`.
        if (critical) {
            // @ts-expect-error
            accept(new Error(message));
        }
        else {
            // @ts-expect-error
            accept(new Error(`failed connection to socket.io: ${message}`));
        }
    };
    /**
     * Hook for the base class: install the authentication middleware on the socket server.
     *
     * Keeps the session store in sync between the passed options and the instance (whichever side has
     * it wins), then registers the passport-based cookie/session check — unless the deployment uses
     * OAuth2 exclusively, in which case no cookie middleware is needed.
     *
     * @param authOptions Authentication configuration: `store` (session store for cookie lookup),
     *  `secret` (used to parse/verify the signed session cookie), `oauth2Only` (when `true`, skip the
     *  cookie/passport middleware entirely) and `checkUser` (optional username/password verification callback).
     */
    __initAuthentication(authOptions) {
        // Synchronise the store in both directions: adopt the one we were given, or hand ours over.
        if (authOptions.store && !this.store) {
            this.store = authOptions.store;
        }
        else if (!authOptions.store && this.store) {
            authOptions.store = this.store;
        }
        if (!authOptions.oauth2Only) {
            this.server?.use((0, socket_classes_1.passportSocket)({
                passport: passport_1.default,
                cookieParser: cookie_parser_1.default,
                checkUser: authOptions.checkUser,
                secret: authOptions.secret, // the session_secret to parse the cookie
                store: authOptions.store, // we NEED to use a sessionstore. no memorystore, please
                success: this.#onAuthorizeSuccess, // *optional* callback on success - read more below
                fail: this.#onAuthorizeFail, // *optional* callback on fail/error - read more below
            }));
        }
    }
    /**
     * Watch a socket's session and notify the client before/when it expires.
     *
     * Looks up the session in the store, then:
     *  - if it is still valid, (re)arms a timer that re-checks at expiry — capped at one hour so a very
     *    long-lived session does not hold a multi-hour timer — and tells the client when it will expire;
     *  - if it has already expired (or cannot be found), asks the client to re-authenticate.
     *
     * The one-hour cap means this method is called repeatedly for long sessions, each time pushing a
     * fresh `expire` timestamp to the client.
     *
     * @param socket The client connection whose session should be monitored.
     */
    #waitForSessionEnd(socket) {
        // Reset any previously scheduled check for this socket.
        if (socket._sessionTimer) {
            clearTimeout(socket._sessionTimer);
            socket._sessionTimer = undefined;
        }
        const sessionId = socket._sessionID;
        if (sessionId) {
            this.store?.get(sessionId, (_err, obj) => {
                if (obj) {
                    const expires = new Date(obj.cookie.expires);
                    const interval = expires.getTime() - Date.now();
                    if (interval > 0) {
                        // Session still valid: schedule the next check (at most 1h away) and inform
                        // the client of the absolute expiry time.
                        socket._sessionTimer ||= setTimeout(() => this.#waitForSessionEnd(socket), interval > 3600000 ? 3600000 : interval);
                        socket.emit('expire', expires.getTime());
                    }
                    else {
                        // Session already expired.
                        this.adapter.log.warn('REAUTHENTICATE!');
                        socket.emit(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE);
                    }
                }
                else {
                    // Session not found in the store.
                    this.adapter.log.warn('REAUTHENTICATE!');
                    socket?.emit?.(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE);
                }
            });
        }
        else {
            // No session id at all → the client must authenticate.
            socket?.emit?.(socket_classes_1.SocketCommon.COMMAND_RE_AUTHENTICATE);
        }
    }
    /**
     * Hook for the base class: return the session id associated with a socket.
     *
     * When authentication is disabled in the adapter config there is no session, so `null` is returned
     * and the base class skips all session-bound bookkeeping.
     *
     * @param socket The client connection.
     * @returns The session id, or `null` when auth is off or the socket has none.
     */
    __getSessionID(socket) {
        return this.adapter.config.auth ? socket._sessionID || null : null;
    }
    /**
     * Broadcast an object/state change to all connected clients (each `publish` performs the
     * per-socket subscription check, so only interested clients actually receive it).
     *
     * @param type The subscription type that changed.
     * @param id The id of the changed object/state.
     * @param obj The new value, or `null`/`undefined` if it was deleted.
     */
    publishAll(type, id, obj) {
        if (id === undefined) {
            this.adapter.log.warn('publishAll called with undefined id');
            return;
        }
        if (this.server?.sockets) {
            // `.sockets` (newer transport) vs `.connected` (older) — support both shapes.
            const sockets = this.server.sockets.sockets || this.server.sockets.connected;
            sockets.forEach(socket => this.publish(socket, type, id, obj));
        }
    }
    /**
     * Broadcast a file change to all connected clients. When a client is actually notified, its session
     * is refreshed via `__updateSession` so active file watchers keep their session alive.
     *
     * @param id The id of the object the file belongs to.
     * @param fileName The name of the changed file.
     * @param size The new file size in bytes, or `null` if deleted.
     */
    publishFileAll(id, fileName, size) {
        if (id === undefined) {
            this.adapter.log.warn('publishFileAll called with undefined id');
            return;
        }
        if (this.server?.sockets) {
            const sockets = this.server.sockets.sockets || this.server.sockets.connected;
            for (const socket of sockets) {
                if (this.publishFile(socket, id, fileName, size)) {
                    this.__updateSession(socket);
                }
            }
        }
    }
    /**
     * Deliver an instance message to the single client whose socket id matches `sid`.
     *
     * @param sourceInstance The instance that produced the message.
     * @param messageType Application-defined message type.
     * @param sid The target socket id.
     * @param data The message payload (object or array).
     */
    publishInstanceMessageAll(sourceInstance, messageType, sid, data) {
        if (this.server?.sockets) {
            const sockets = this.server.sockets.sockets || this.server.sockets.connected;
            // this could be an object or array
            for (const socket of sockets) {
                if (socket.id === sid) {
                    if (this.publishInstanceMessage(socket, sourceInstance, messageType, data)) {
                        this.__updateSession(socket);
                    }
                }
            }
        }
    }
}
exports.SocketWS = SocketWS;
//# sourceMappingURL=socketWS.js.map