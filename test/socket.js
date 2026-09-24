'use strict';

/**
 * Tests for `IOSocketClass` - the facade an adapter instantiates once during startup.
 *
 * The class is deliberately thin, so the tests check exactly what it promises: it starts a real
 * socket server on the adapter's HTTP server, forwards every `publish*` / `sendLog` call to the
 * protocol handler, and survives being closed (and being used afterwards) without throwing.
 */

const { ok, strictEqual, deepStrictEqual, throws } = require('node:assert');

const { IOSocketClass, SocketWS } = require('../build');
const { closeHttpServer, createHttpServer, createMemoryStore, createMockAdapter } = require('./lib/helpers');

describe('IOSocketClass', () => {
    let httpServer;
    let io;

    beforeEach(async () => {
        httpServer = await createHttpServer();
    });

    afterEach(async () => {
        io?.close();
        io = null;
        await closeHttpServer(httpServer);
        httpServer = null;
    });

    /** Start the facade on the running HTTP server */
    function start(settings = {}, config = {}, checkUser) {
        const adapter = createMockAdapter({ port: httpServer.address().port, ...config });
        const store = createMemoryStore();
        io = new IOSocketClass(
            httpServer,
            { auth: false, secure: false, port: httpServer.address().port, ...settings },
            adapter,
            store,
            checkUser,
        );
        return { adapter, store };
    }

    describe('construction', () => {
        it('creates the WS protocol handler and starts it on the HTTP server', () => {
            const { adapter } = start();

            ok(io.ioServer instanceof SocketWS, 'ioServer must be the WS implementation');
            ok(io.ioServer.server, 'the socket server must be listening on the HTTP server');
            ok(
                adapter.logs.info.some(m => m.includes('socket.io server listening on port')),
                `startup must be logged, got: ${JSON.stringify(adapter.logs.info)}`,
            );
        });

        it('announces a TLS server as secure', () => {
            const { adapter } = start({ secure: true });

            ok(
                adapter.logs.info.some(m => m.startsWith('Secure socket.io server listening')),
                `got: ${JSON.stringify(adapter.logs.info)}`,
            );
        });

        it('passes the store to the authentication when auth is on', () => {
            const { store } = start({ auth: true, secret: 'a-secret' }, { auth: true });

            // `__initAuthentication` adopts the store it was given; the session handling needs it
            strictEqual(io.ioServer.store, store);
        });

        it('leaves the store alone when authentication is off', () => {
            start({ auth: false }, { auth: false });

            // without auth the base class never calls `__initAuthentication`
            strictEqual(io.ioServer.store, null);
        });

        it('refuses to start without an HTTP server', () => {
            const adapter = createMockAdapter();
            throws(() => new IOSocketClass(undefined, { auth: false }, adapter, createMemoryStore()), /Server cannot be empty/);
        });
    });

    describe('delegation to the protocol handler', () => {
        /** Replace the `publish*`/`sendLog` methods of the handler by recorders */
        function spyOnHandler() {
            const calls = [];
            for (const method of ['publishAll', 'publishFileAll', 'publishInstanceMessageAll', 'sendLog']) {
                io.ioServer[method] = (...args) => calls.push([method, ...args]);
            }
            return calls;
        }

        it('forwards publishAll, publishFileAll, publishInstanceMessageAll and sendLog unchanged', () => {
            start();
            const calls = spyOnHandler();
            const logMessage = { message: 'hello', severity: 'info', from: 'ws.0', ts: 1, _id: 1 };

            io.publishAll('stateChange', 'my.0.state', { val: 1, ack: true });
            io.publishFileAll('vis.0', 'main/vis-views.json', 17);
            io.publishInstanceMessageAll('cameras.0', 'snapshot', 'socket-1', { a: 1 });
            io.sendLog(logMessage);

            deepStrictEqual(calls, [
                ['publishAll', 'stateChange', 'my.0.state', { val: 1, ack: true }],
                ['publishFileAll', 'vis.0', 'main/vis-views.json', 17],
                ['publishInstanceMessageAll', 'cameras.0', 'snapshot', 'socket-1', { a: 1 }],
                ['sendLog', logMessage],
            ]);
        });
    });

    describe('getWhiteListIpForAddress', () => {
        // the whitelist is keyed by address, `*` stands for any octet
        const whiteList = {
            '192.168.1.1': { user: 'user' },
            '192.168.1.*': { user: 'family' },
            default: { user: 'default' },
        };

        beforeEach(() => start());

        it('prefers the exact address over the wildcard entry', () => {
            strictEqual(io.getWhiteListIpForAddress('192.168.1.1', whiteList), '192.168.1.1');
        });

        it('matches an address through the wildcard entry', () => {
            strictEqual(io.getWhiteListIpForAddress('192.168.1.2', whiteList), '192.168.1.*');
        });

        it('returns null for an address no entry covers', () => {
            // `default` is applied by the permission lookup, not reported as a match here
            strictEqual(io.getWhiteListIpForAddress('10.0.0.1', whiteList), null);
        });

        it('returns null without a whitelist and for IPv6 that is not listed literally', () => {
            strictEqual(io.getWhiteListIpForAddress('192.168.1.1', undefined), null);
            strictEqual(io.getWhiteListIpForAddress('::1', whiteList), null);
            strictEqual(io.getWhiteListIpForAddress('::1', { '::1': { user: 'local' } }), '::1');
        });
    });

    describe('close', () => {
        it('stops the handler and releases the reference', () => {
            start();
            const handler = io.ioServer;

            io.close();

            strictEqual(io.ioServer, null, 'the reference must be released so nothing is published anymore');
            strictEqual(handler.server, null, 'the socket server must be closed');
        });

        it('can be called twice', () => {
            start();
            io.close();
            io.close();
            strictEqual(io.ioServer, null);
        });

        it('turns later publish and log calls into no-ops instead of throwing', () => {
            start();
            io.close();

            io.publishAll('stateChange', 'my.0.state', { val: 1 });
            io.publishFileAll('vis.0', 'main/vis-views.json', 1);
            io.publishInstanceMessageAll('cameras.0', 'snapshot', 'socket-1', {});
            io.sendLog({ message: 'after close', severity: 'info', from: 'ws.0', ts: 1, _id: 1 });
        });
    });
});
