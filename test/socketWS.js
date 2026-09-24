'use strict';

/**
 * Unit tests for `SocketWS`, the WS-specific half of `SocketCommon`.
 *
 * Everything here works on a bare instance: `start()` is never called, the server and the publish
 * helpers of the base class are replaced by fakes. That keeps the tests on the code this repository
 * actually owns - the loop over the connected sockets, the session bookkeeping and the
 * authentication wiring - instead of re-testing `@iobroker/socket-classes`.
 */

const { ok, strictEqual, deepStrictEqual, throws } = require('node:assert');

const { SocketWS } = require('../build');
const { SocketCommon } = require('@iobroker/socket-classes');
const {
    createFakeSocket,
    createFakeSocketServer,
    createMemoryStore,
    createMockAdapter,
    createSession,
    signSessionCookie,
} = require('./lib/helpers');

/** Secret the session cookies of these tests are signed with */
const SECRET = 'a-test-secret';

/**
 * A `SocketWS` that is ready for the publish tests: it has a server with `sockets`, and the
 * publish helpers of the base class are replaced by recorders.
 *
 * @param sockets Connected clients
 * @param options Options
 * @param options.legacy Expose the clients as `sockets.connected` instead of `sockets.sockets`
 * @param options.result What the stubbed `publish*` helpers return
 * @param options.config `adapter.config`
 */
function createPublisher(sockets, options = {}) {
    const adapter = createMockAdapter(options.config);
    const ws = new SocketWS({ auth: false }, adapter);
    ws.server = createFakeSocketServer(sockets, options);

    const calls = { publish: [], publishFile: [], publishInstanceMessage: [], updateSession: [] };
    const answer = typeof options.result === 'function' ? options.result : () => options.result !== false;

    ws.publish = (socket, type, id, obj) => {
        calls.publish.push([socket.id, type, id, obj]);
        return answer(socket);
    };
    ws.publishFile = (socket, id, fileName, size) => {
        calls.publishFile.push([socket.id, id, fileName, size]);
        return answer(socket);
    };
    ws.publishInstanceMessage = (socket, sourceInstance, messageType, data) => {
        calls.publishInstanceMessage.push([socket.id, sourceInstance, messageType, data]);
        return answer(socket);
    };
    ws.__updateSession = socket => {
        calls.updateSession.push(socket.id);
        return true;
    };

    return { ws, adapter, calls };
}

describe('SocketWS', () => {
    describe('__getIsNoDisconnect', () => {
        it('keeps unauthenticated sockets open', () => {
            // pure web sockets are re-authenticated in place, the base class must not drop them
            const ws = new SocketWS({ auth: false }, createMockAdapter());
            strictEqual(ws.__getIsNoDisconnect(), true);
        });
    });

    describe('__getSessionID', () => {
        it('returns the session id of the socket when authentication is on', () => {
            const ws = new SocketWS({ auth: true }, createMockAdapter({ auth: true }));
            strictEqual(ws.__getSessionID(createFakeSocket('a', { _sessionID: 'sess-1' })), 'sess-1');
        });

        it('returns null when authentication is off, even if the socket has a session', () => {
            // without auth there is nothing to keep alive, so the base class must skip the bookkeeping
            const ws = new SocketWS({ auth: false }, createMockAdapter({ auth: false }));
            strictEqual(ws.__getSessionID(createFakeSocket('a', { _sessionID: 'sess-1' })), null);
        });

        it('returns null when the socket has no session id', () => {
            const ws = new SocketWS({ auth: true }, createMockAdapter({ auth: true }));
            strictEqual(ws.__getSessionID(createFakeSocket('a')), null);
        });

        it('reads the flag from the adapter config, not from the socket settings', () => {
            // `adapter.config` is the live configuration; the settings are only a snapshot
            const adapter = createMockAdapter({ auth: false });
            const ws = new SocketWS({ auth: true }, adapter);
            const socket = createFakeSocket('a', { _sessionID: 'sess-1' });

            strictEqual(ws.__getSessionID(socket), null);
            adapter.config.auth = true;
            strictEqual(ws.__getSessionID(socket), 'sess-1');
        });
    });

    describe('__initAuthentication', () => {
        it('installs the passport middleware on the server', () => {
            const ws = new SocketWS({ auth: true }, createMockAdapter({ auth: true }));
            ws.server = createFakeSocketServer();

            ws.__initAuthentication({ store: createMemoryStore(), secret: 'a-secret' });

            strictEqual(ws.server.middlewares.length, 1, 'exactly one middleware must be installed');
            strictEqual(typeof ws.server.middlewares[0], 'function');
        });

        it('skips the cookie middleware when only OAuth2 is used', () => {
            const ws = new SocketWS({ auth: true }, createMockAdapter({ auth: true }));
            ws.server = createFakeSocketServer();

            ws.__initAuthentication({ store: createMemoryStore(), oauth2Only: true });

            deepStrictEqual(ws.server.middlewares, [], 'no cookie middleware without cookies');
        });

        it('adopts the store it was given', () => {
            const ws = new SocketWS({ auth: true }, createMockAdapter({ auth: true }));
            ws.server = createFakeSocketServer();
            const store = createMemoryStore();

            ws.__initAuthentication({ store });

            strictEqual(ws.store, store, 'the store must be reachable for the session handling');
        });

        it('hands its own store over when none was given', () => {
            const ws = new SocketWS({ auth: true }, createMockAdapter({ auth: true }));
            ws.server = createFakeSocketServer();
            const store = createMemoryStore();
            ws.store = store;

            const authOptions = { store: undefined };
            ws.__initAuthentication(authOptions);

            strictEqual(authOptions.store, store, 'the middleware must not be created without a store');
            strictEqual(ws.store, store);
        });

        it('keeps its own store when both sides have one', () => {
            const ws = new SocketWS({ auth: true }, createMockAdapter({ auth: true }));
            ws.server = createFakeSocketServer();
            const own = createMemoryStore();
            const other = createMemoryStore();
            ws.store = own;

            ws.__initAuthentication({ store: other });

            strictEqual(ws.store, own);
        });

        it('does nothing when there is no server yet', () => {
            const ws = new SocketWS({ auth: true }, createMockAdapter({ auth: true }));
            ws.__initAuthentication({ store: createMemoryStore() });
            strictEqual(ws.server, null);
        });

        it('authenticates an upgrade request through the installed middleware', async () => {
            // the middleware is what really decides whether a browser may connect, so run one
            // request through it: a valid session must be accepted, a missing one rejected
            const adapter = createMockAdapter({ auth: true });
            const ws = new SocketWS({ auth: true }, adapter);
            ws.server = createFakeSocketServer();
            const store = createMemoryStore();
            store.sessions['session-1'] = createSession('admin');
            ws.__initAuthentication({ store, secret: SECRET });
            const middleware = ws.server.middlewares[0];

            const request = {
                url: '/?sid=1',
                headers: { cookie: signSessionCookie('session-1', SECRET) },
                socket: { remoteAddress: '127.0.0.1', emit: () => {} },
                connection: { remoteAddress: '127.0.0.1' },
            };
            const accepted = await new Promise(resolve => middleware(request, resolve));

            strictEqual(accepted, false, 'a valid session must be accepted without an error');
            strictEqual(request.sessionID, 'session-1', 'the session id must be taken from the signed cookie');
            deepStrictEqual(request.user, { user: 'admin', logged_in: true });
            ok(
                adapter.logs.debug.some(m => m.includes('successful connection')),
                'the success callback must log the accepted connection',
            );
        });

        it('asks a client without a session to re-authenticate', async () => {
            const adapter = createMockAdapter({ auth: true });
            const ws = new SocketWS({ auth: true }, adapter);
            ws.server = createFakeSocketServer();
            ws.__initAuthentication({ store: createMemoryStore() });
            const middleware = ws.server.middlewares[0];

            const emitted = [];
            const request = {
                url: '/?sid=1',
                headers: {},
                socket: { remoteAddress: '127.0.0.1', emit: name => emitted.push(name) },
                connection: { remoteAddress: '127.0.0.1' },
            };
            const error = await new Promise(resolve => middleware(request, resolve));

            ok(error instanceof Error, 'the client must receive an error package');
            ok(error.message.includes('No session id'), `unexpected message: ${error.message}`);

            // the re-authenticate nudge is sent slightly later, so the error arrives first
            deepStrictEqual(emitted, [], 'the nudge must not be sent synchronously');
            await new Promise(resolve => setTimeout(resolve, 150));
            deepStrictEqual(emitted, [SocketCommon.COMMAND_RE_AUTHENTICATE]);
        });

        it('logs only critical authentication failures', async () => {
            const adapter = createMockAdapter({ auth: true });
            const ws = new SocketWS({ auth: true }, adapter);
            ws.server = createFakeSocketServer();
            const store = createMemoryStore();
            // a session without passport is a hard ("critical") failure
            store.sessions['session-1'] = { cookie: {} };
            ws.__initAuthentication({ store, secret: SECRET });
            const middleware = ws.server.middlewares[0];

            const request = {
                url: '/?sid=1',
                headers: { cookie: signSessionCookie('session-1', SECRET) },
                socket: { remoteAddress: '1.2.3.4', emit: () => {} },
                connection: { remoteAddress: '1.2.3.4' },
            };
            const error = await new Promise(resolve => middleware(request, resolve));

            ok(error instanceof Error);
            strictEqual(error.message, 'Passport was not initialized', 'a critical error is reported verbatim');
            ok(
                adapter.logs.info.some(m => m.includes('failed connection') && m.includes('1.2.3.4')),
                `the remote address must be logged, got: ${JSON.stringify(adapter.logs.info)}`,
            );
            await new Promise(resolve => setTimeout(resolve, 150));
        });
    });

    describe('publishAll', () => {
        it('offers the change to every connected socket', () => {
            const sockets = [createFakeSocket('a'), createFakeSocket('b')];
            const { ws, calls } = createPublisher(sockets);

            ws.publishAll('stateChange', 'my.0.state', { val: 1, ack: true });

            deepStrictEqual(calls.publish, [
                ['a', 'stateChange', 'my.0.state', { val: 1, ack: true }],
                ['b', 'stateChange', 'my.0.state', { val: 1, ack: true }],
            ]);
        });

        it('also finds the sockets of the older transport (sockets.connected)', () => {
            const { ws, calls } = createPublisher([createFakeSocket('a')], { legacy: true });

            ws.publishAll('objectChange', 'my.0.obj', null);

            deepStrictEqual(calls.publish, [['a', 'objectChange', 'my.0.obj', null]]);
        });

        it('warns and does nothing when the id is undefined', () => {
            const { ws, adapter, calls } = createPublisher([createFakeSocket('a')]);

            ws.publishAll('stateChange', undefined, { val: 1 });

            deepStrictEqual(calls.publish, []);
            deepStrictEqual(adapter.logs.warn, ['publishAll called with undefined id']);
        });

        it('still publishes a deleted state (null) and an empty id', () => {
            const { ws, calls } = createPublisher([createFakeSocket('a')]);

            ws.publishAll('stateChange', '', null);

            deepStrictEqual(calls.publish, [['a', 'stateChange', '', null]]);
        });

        it('does nothing when the server is gone', () => {
            const { ws, calls } = createPublisher([createFakeSocket('a')]);
            ws.server = null;

            ws.publishAll('stateChange', 'my.0.state', { val: 1 });

            deepStrictEqual(calls.publish, []);
        });
    });

    describe('publishFileAll', () => {
        it('refreshes the session of every socket that was notified', () => {
            const sockets = [createFakeSocket('a'), createFakeSocket('b')];
            // only "a" is subscribed to that file
            const { ws, calls } = createPublisher(sockets, { result: socket => socket.id === 'a' });

            ws.publishFileAll('vis.0', 'main/vis-views.json', 128);

            deepStrictEqual(calls.publishFile, [
                ['a', 'vis.0', 'main/vis-views.json', 128],
                ['b', 'vis.0', 'main/vis-views.json', 128],
            ]);
            deepStrictEqual(calls.updateSession, ['a'], 'only a notified client keeps its session alive');
        });

        it('passes a deletion (size null) on unchanged', () => {
            const { ws, calls } = createPublisher([createFakeSocket('a')]);

            ws.publishFileAll('vis.0', 'main/gone.json', null);

            deepStrictEqual(calls.publishFile, [['a', 'vis.0', 'main/gone.json', null]]);
        });

        it('also finds the sockets of the older transport (sockets.connected)', () => {
            const { ws, calls } = createPublisher([createFakeSocket('a')], { legacy: true });

            ws.publishFileAll('vis.0', 'main/vis-views.json', 1);

            deepStrictEqual(calls.publishFile, [['a', 'vis.0', 'main/vis-views.json', 1]]);
        });

        it('warns and does nothing when the id is undefined', () => {
            const { ws, adapter, calls } = createPublisher([createFakeSocket('a')]);

            ws.publishFileAll(undefined, 'main/vis-views.json', 1);

            deepStrictEqual(calls.publishFile, []);
            deepStrictEqual(adapter.logs.warn, ['publishFileAll called with undefined id']);
        });

        it('does nothing when the server is gone', () => {
            const { ws, calls } = createPublisher([createFakeSocket('a')]);
            ws.server = null;

            ws.publishFileAll('vis.0', 'main/vis-views.json', 1);

            deepStrictEqual(calls.publishFile, []);
        });
    });

    describe('publishInstanceMessageAll', () => {
        it('delivers only to the socket the message is addressed to', () => {
            const sockets = [createFakeSocket('a'), createFakeSocket('b'), createFakeSocket('c')];
            const { ws, calls } = createPublisher(sockets);

            ws.publishInstanceMessageAll('cameras.0', 'snapshot', 'b', { file: 'cam1.jpg' });

            deepStrictEqual(calls.publishInstanceMessage, [['b', 'cameras.0', 'snapshot', { file: 'cam1.jpg' }]]);
            deepStrictEqual(calls.updateSession, ['b']);
        });

        it('does not refresh the session when the client was not subscribed', () => {
            const { ws, calls } = createPublisher([createFakeSocket('b')], { result: false });

            ws.publishInstanceMessageAll('cameras.0', 'snapshot', 'b', []);

            deepStrictEqual(calls.publishInstanceMessage, [['b', 'cameras.0', 'snapshot', []]]);
            deepStrictEqual(calls.updateSession, []);
        });

        it('ignores an unknown socket id', () => {
            const { ws, calls } = createPublisher([createFakeSocket('a')]);

            ws.publishInstanceMessageAll('cameras.0', 'snapshot', 'nobody', {});

            deepStrictEqual(calls.publishInstanceMessage, []);
            deepStrictEqual(calls.updateSession, []);
        });

        it('also finds the sockets of the older transport (sockets.connected)', () => {
            const { ws, calls } = createPublisher([createFakeSocket('a')], { legacy: true });

            ws.publishInstanceMessageAll('cameras.0', 'snapshot', 'a', {});

            deepStrictEqual(calls.publishInstanceMessage, [['a', 'cameras.0', 'snapshot', {}]]);
        });

        it('does nothing when the server is gone', () => {
            const { ws, calls } = createPublisher([createFakeSocket('a')]);
            ws.server = null;

            ws.publishInstanceMessageAll('cameras.0', 'snapshot', 'a', {});

            deepStrictEqual(calls.publishInstanceMessage, []);
        });
    });

    describe('start', () => {
        it('refuses to start without a server', () => {
            const ws = new SocketWS({ auth: false }, createMockAdapter());
            throws(() => ws.start(undefined), /Server cannot be empty/);
        });
    });
});
