'use strict';

/**
 * A thin promise wrapper around the real browser client `@iobroker/ws`.
 *
 * The integration tests deliberately use the very client the library is written for instead of
 * talking the wire protocol by hand: that way a test proves that an adapter embedding
 * `IOSocketClass` really serves a browser, not only that the internal methods behave.
 *
 * The client is a browser bundle, but its CommonJS build runs unchanged in Node - it registers
 * itself as `globalThis.io` and uses the global `WebSocket` implementation of Node.
 */

require('@iobroker/ws');

const { DEFAULT_TIMEOUT, waitFor } = require('./helpers');

class TestClient {
    /**
     * @param port Port of the HTTP server the socket server is attached to
     * @param options Options for `io.connect` (`name`, `token`, …). `query` is not passed on but
     *  appended to the URL, which is how a browser sends credentials in the upgrade request.
     */
    constructor(port, options = {}) {
        /** Every event that was received, as `{ name, args }` */
        this.events = [];
        this.connected = false;

        const { query, ...connectOptions } = options;
        const search = query
            ? `?${Object.entries(query)
                  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                  .join('&')}`
            : '';

        this.socket = globalThis.io.connect(`ws://127.0.0.1:${port}/${search}`, {
            connectTimeout: DEFAULT_TIMEOUT,
            authTimeout: DEFAULT_TIMEOUT,
            ...connectOptions,
        });

        // The bundled client logs reconnect attempts to the console; a test that closes a server on
        // purpose would spam the mocha output with them.
        this.socket.log = { debug: () => {}, warn: () => {}, error: () => {} };

        for (const name of ['connect', 'disconnect', 'reauthenticate', 'error', 'stateChange', 'objectChange', 'fileChange', 'im', 'log', 'expire', 'tokenInfo']) {
            this.socket.on(name, (...args) => {
                if (name === 'connect') {
                    this.connected = true;
                } else if (name === 'disconnect') {
                    this.connected = false;
                }
                this.events.push({ name, args });
            });
        }
    }

    /** Names of all received events, for compact assertions */
    eventNames() {
        return this.events.map(e => e.name);
    }

    /** All events with the given name */
    eventsOf(name) {
        return this.events.filter(e => e.name === name);
    }

    /** Resolve as soon as at least `count` events with that name arrived */
    waitForEvent(name, count = 1, timeout = DEFAULT_TIMEOUT) {
        return waitFor(
            () => {
                const found = this.eventsOf(name);
                return found.length >= count ? found[count - 1] : null;
            },
            `event "${name}" #${count}`,
            timeout,
        );
    }

    /** Resolve once the client is connected (or reject after `timeout`) */
    async waitForConnect(timeout = DEFAULT_TIMEOUT) {
        await this.waitForEvent('connect', 1, timeout);
        return this;
    }

    /**
     * Send a command and resolve with all arguments the server passed to the callback.
     *
     * @returns The callback arguments as an array, e.g. `[error, result]`
     */
    emit(command, ...args) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timeout while waiting for answer of "${command}"`)), DEFAULT_TIMEOUT);
            this.socket.emit(command, ...args, (...answer) => {
                clearTimeout(timer);
                resolve(answer);
            });
        });
    }

    /** Send a command without expecting an answer */
    send(command, ...args) {
        this.socket.emit(command, ...args);
    }

    /**
     * Close the connection for good.
     *
     * `close()` of the client reconnects by default, so a test that only called it would leave a
     * reconnect loop behind and the mocha process would never end.
     */
    close() {
        this.socket.destroy();
    }
}

/** Create a client and wait until it is connected */
async function connectClient(port, options) {
    const client = new TestClient(port, options);
    await client.waitForConnect();
    return client;
}

module.exports = { TestClient, connectClient };
