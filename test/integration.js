'use strict';

/**
 * End-to-end tests: a real HTTP server, the real transport and the real browser client
 * (`@iobroker/ws`).
 *
 * These are the tests that prove the library does what an adapter embeds it for - a browser can
 * connect, subscribe and receive what the adapter publishes - and they cover the code paths that
 * only exist once all three layers are wired together: the authentication middleware, the session
 * handling and the per-socket dispatch of the `publish*All` methods.
 */

const { ok, strictEqual, deepStrictEqual } = require('node:assert');

const { IOSocketClass } = require('../build');
const { SocketCommon } = require('@iobroker/socket-classes');
const {
    closeHttpServer,
    createHttpServer,
    createMemoryStore,
    createMockAdapter,
    wait,
    waitFor,
} = require('./lib/helpers');
const { TestClient, connectClient } = require('./lib/client');

describe('integration', function () {
    this.timeout(15000);

    /** Everything that has to be torn down after a test, newest first */
    let httpServer;
    let io;
    let clients;

    beforeEach(() => {
        clients = [];
    });

    afterEach(async () => {
        for (const client of clients) {
            client.close();
        }
        clients = [];
        io?.close();
        io = null;
        await closeHttpServer(httpServer);
        httpServer = null;
    });

    /**
     * Start an HTTP server with the socket server on top of it, exactly as an adapter would.
     *
     * @param settings Socket settings (merged onto `auth: false`)
     * @param config `adapter.config`
     */
    async function startServer(settings = {}, config = {}) {
        httpServer = await createHttpServer();
        const port = httpServer.address().port;
        const adapter = createMockAdapter({ port, auth: !!settings.auth, ...config });
        const store = createMemoryStore();
        io = new IOSocketClass(httpServer, { auth: false, secure: false, port, ...settings }, adapter, store);
        return { port, adapter, store };
    }

    /** Connect a client that is closed automatically after the test */
    async function connect(port, options) {
        const client = await connectClient(port, options);
        clients.push(client);
        return client;
    }

    /** The server-side socket objects, in connection order */
    function serverSockets() {
        return io.ioServer.server.sockets.sockets;
    }

    describe('without authentication', () => {
        it('accepts a client and answers its commands', async () => {
            const { port, adapter } = await startServer();

            const client = await connect(port, { name: 'browser-1' });

            strictEqual(serverSockets().length, 1, 'the server must know the connected client');
            const [error, name] = await client.emit('getAdapterName');
            strictEqual(error, null);
            strictEqual(name, 'ws');
            ok(
                adapter.logs.info.some(m => m.includes('==> Connected system.user.admin')),
                `the connection must be logged, got: ${JSON.stringify(adapter.logs.info)}`,
            );
        });

        it('publishes a state change only to the clients whose pattern matches', async () => {
            const { port } = await startServer();
            const subscribed = await connect(port, { name: 'subscribed' });
            const other = await connect(port, { name: 'other' });

            await subscribed.emit('subscribe', 'my.0.*');
            await other.emit('subscribe', 'other.0.*');

            io.publishAll('stateChange', 'my.0.temperature', { val: 21.5, ack: true });

            const event = await subscribed.waitForEvent('stateChange');
            deepStrictEqual(event.args, ['my.0.temperature', { val: 21.5, ack: true }]);
            await wait(100);
            deepStrictEqual(other.eventsOf('stateChange'), [], 'a non-matching client must not be notified');
        });

        it('publishes a file change to the subscribed client', async () => {
            const { port } = await startServer();
            const client = await connect(port, { name: 'browser-1' });
            await client.emit('subscribeFiles', 'vis.0', '*');

            io.publishFileAll('vis.0', 'main/vis-views.json', 4096);

            const event = await client.waitForEvent('fileChange');
            deepStrictEqual(event.args, ['vis.0', 'main/vis-views.json', 4096]);
        });

        it('delivers an instance message only to the addressed socket', async () => {
            const { port } = await startServer();
            const first = await connect(port, { name: 'first' });
            const second = await connect(port, { name: 'second' });

            await first.emit('clientSubscribe', 'cameras.0', 'snapshot');
            await second.emit('clientSubscribe', 'cameras.0', 'snapshot');

            const [firstSocket] = serverSockets();
            io.publishInstanceMessageAll('system.adapter.cameras.0', 'snapshot', firstSocket.id, { file: 'cam1.jpg' });

            const event = await first.waitForEvent('im');
            deepStrictEqual(event.args, ['snapshot', 'system.adapter.cameras.0', { file: 'cam1.jpg' }]);
            await wait(100);
            deepStrictEqual(second.eventsOf('im'), [], 'only the addressed socket may receive the message');
        });

        it('sends the log to the clients that subscribed to it', async () => {
            const { port } = await startServer();
            const subscribed = await connect(port, { name: 'with-log' });
            const other = await connect(port, { name: 'without-log' });
            const logMessage = { message: 'hello', severity: 'info', from: 'ws.0', ts: Date.now(), _id: 1 };

            // the plain `ws` adapter has no `requireLog` command, an adapter enables the stream itself
            serverSockets()[0].subscribe = { log: [{ pattern: '*', regex: /.*/ }] };

            io.sendLog(logMessage);

            const event = await subscribed.waitForEvent('log');
            deepStrictEqual(event.args, [logMessage]);
            deepStrictEqual(other.eventsOf('log'), [], 'a client without a log subscription must stay quiet');
        });

        it('forgets a socket when the browser disconnects', async () => {
            const { port } = await startServer();
            const client = await connect(port, { name: 'leaving' });
            strictEqual(serverSockets().length, 1);

            client.close();

            await waitFor(() => serverSockets().length === 0, 'the socket to be removed');
        });

        it('publishes nothing anymore after close()', async () => {
            const { port } = await startServer();
            const client = await connect(port, { name: 'browser-1' });
            await client.emit('subscribe', '*');

            io.close();
            io = null;
            await waitFor(() => !client.connected, 'the client to notice the shutdown');

            deepStrictEqual(client.eventsOf('stateChange'), []);
        });
    });

    describe('with authentication', () => {
        it('rejects a client without any credentials and asks it to re-authenticate', async () => {
            const { port, adapter } = await startServer({ auth: true, secret: 'a-secret' });

            const client = new TestClient(port, { name: 'anonymous' });
            clients.push(client);

            await client.waitForEvent(SocketCommon.COMMAND_RE_AUTHENTICATE);
            strictEqual(client.connected, false, 'an unauthenticated client must not be connected');
            strictEqual(serverSockets().length, 0, 'the upgrade must not produce a socket');
            ok(
                adapter.logs.debug.some(m => m.includes('authentication failed')),
                `the rejection must be logged, got: ${JSON.stringify(adapter.logs.debug)}`,
            );
        });

        it('accepts a client that presents a valid access token', async () => {
            const { port, adapter, store } = await startServer({ auth: true, secret: 'a-secret' });
            const token = { user: 'admin', aExp: Date.now() + 3600000 };
            // the middleware reads the token from the store, `_initSocket` from the adapter
            store.sessions['a:token-1'] = token;
            adapter.sessions['a:token-1'] = token;

            const client = await connect(port, { name: 'browser-1', token: 'token-1' });

            const [, acl] = await client.emit('getUserPermissions');
            strictEqual(acl.user, 'system.user.admin');
            const [socket] = serverSockets();
            strictEqual(socket._secure, true, 'an authenticated socket must be marked secure');
            ok(
                adapter.logs.debug.some(m => m.includes('successful connection')),
                `the success callback must log, got: ${JSON.stringify(adapter.logs.debug)}`,
            );
        });

        it('rejects an unknown access token', async () => {
            const { port } = await startServer({ auth: true, secret: 'a-secret' });

            const client = new TestClient(port, { name: 'browser-1', token: 'does-not-exist' });
            clients.push(client);

            await client.waitForEvent(SocketCommon.COMMAND_RE_AUTHENTICATE);
            strictEqual(client.connected, false);
        });

        it('lets a user log in with name and password through checkUser', async () => {
            httpServer = await createHttpServer();
            const port = httpServer.address().port;
            const adapter = createMockAdapter({ port, auth: true });
            const checked = [];
            const checkUser = (user, pass, cb) => {
                checked.push([user, pass]);
                cb(null, user === 'admin' && pass === 'secret' ? { logged_in: true, user } : undefined);
            };
            io = new IOSocketClass(
                httpServer,
                { auth: true, secure: false, port, secret: 'a-secret' },
                adapter,
                createMemoryStore(),
                checkUser,
            );

            // the credentials travel in the query of the upgrade request
            const client = new TestClient(port, { name: 'browser-1', query: { user: 'admin', pass: 'secret' } });
            clients.push(client);

            await client.waitForConnect();
            deepStrictEqual(checked[0], ['admin', 'secret']);
            ok(
                adapter.logs.debug.some(m => m.includes('successful connection')),
                `got: ${JSON.stringify(adapter.logs.debug)}`,
            );
        });

        it('rejects a wrong password', async () => {
            httpServer = await createHttpServer();
            const port = httpServer.address().port;
            const adapter = createMockAdapter({ port, auth: true });
            const checkUser = (user, pass, cb) => cb(null, pass === 'secret' ? { logged_in: true, user } : undefined);
            io = new IOSocketClass(
                httpServer,
                { auth: true, secure: false, port, secret: 'a-secret' },
                adapter,
                createMemoryStore(),
                checkUser,
            );

            const client = new TestClient(port, { name: 'browser-1', query: { user: 'admin', pass: 'wrong' } });
            clients.push(client);

            await client.waitForEvent(SocketCommon.COMMAND_RE_AUTHENTICATE);
            strictEqual(client.connected, false);
        });
    });
});
