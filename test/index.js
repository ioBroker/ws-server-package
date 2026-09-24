'use strict';

/**
 * The package is a library, so its public surface *is* the feature: an adapter must be able to
 * import exactly these names, and the package exports must point at files that the build really
 * produced (`build/lib/socket.io.js` and `build/types.d.ts` are written by `tasks.mts`, not by
 * `tsc`, and have been missing from a release before).
 */

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { ok, strictEqual, deepStrictEqual } = require('node:assert');

const lib = require('../build');
const { SocketCommon } = require('@iobroker/socket-classes');
const { Socket: TransportSocket, SocketIO: TransportServer } = require('@iobroker/ws-server');

const packageJson = require('../package.json');
const root = join(__dirname, '..');

describe('public API', () => {
    it('exports SocketWS, IOSocketClass and WebSocketClient', () => {
        deepStrictEqual(Object.keys(lib).sort(), ['IOSocketClass', 'SocketWS', 'WebSocketClient']);
        strictEqual(typeof lib.SocketWS, 'function');
        strictEqual(typeof lib.IOSocketClass, 'function');
        strictEqual(typeof lib.WebSocketClient, 'function');
    });

    it('SocketWS is a SocketCommon of the socket-classes package', () => {
        ok(lib.SocketWS.prototype instanceof SocketCommon, 'SocketWS must extend SocketCommon');
    });

    it('implements every hook SocketCommon leaves abstract', () => {
        // SocketCommon throws for these unless a transport implements them
        for (const hook of ['__getIsNoDisconnect', '__initAuthentication', '__getSessionID']) {
            ok(
                Object.prototype.hasOwnProperty.call(lib.SocketWS.prototype, hook),
                `SocketWS must implement "${hook}"`,
            );
        }
    });

    it('WebSocketClient is the connection type of the transport, not this repo', () => {
        // `@iobroker/ws-server` is a *different* package than this one and provides the connection
        strictEqual(lib.WebSocketClient, TransportSocket);
        ok(TransportServer !== lib.IOSocketClass, 'IOSocketClass must not be the transport server');
    });

    it('IOSocketClass offers the facade an adapter uses', () => {
        for (const method of [
            'publishAll',
            'publishFileAll',
            'publishInstanceMessageAll',
            'sendLog',
            'close',
            'getWhiteListIpForAddress',
        ]) {
            strictEqual(typeof lib.IOSocketClass.prototype[method], 'function', `${method} must exist`);
        }
    });

    describe('package exports', () => {
        it('every exported path exists in the build', () => {
            for (const target of Object.values(packageJson.exports)) {
                const paths = typeof target === 'string' ? [target] : Object.values(target);
                for (const path of paths) {
                    ok(existsSync(join(root, path)), `${path} is exported but was not built`);
                }
            }
        });

        it('"./socket.io.js" serves the browser client', () => {
            // tasks.mts copies the bundled `@iobroker/ws` client next to the compiled code so a web
            // adapter can deliver it to the browser
            const served = readFileSync(join(root, packageJson.exports['./socket.io.js']));
            const original = readFileSync(require.resolve('@iobroker/ws'));
            deepStrictEqual(served, original, 'the served client must be the bundled @iobroker/ws');
        });

        it('the hand-written types.d.ts is copied next to the compiled declarations', () => {
            // `src/types.d.ts` is an input for tsc, so it emits nothing for it - tasks.mts copies it,
            // otherwise the `./types` re-export in build/index.d.ts does not resolve
            const types = readFileSync(join(root, 'build/types.d.ts'), 'utf8');
            ok(types.includes('interface WsConfig'), 'build/types.d.ts must declare WsConfig');
            ok(readFileSync(join(root, 'build/index.d.ts'), 'utf8').includes('./types'));
        });

        it('only ships the build and the license', () => {
            deepStrictEqual(packageJson.files, ['build/', 'LICENSE']);
        });
    });
});
