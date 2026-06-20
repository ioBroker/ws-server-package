/**
 * Shape of the adapter's `native` configuration (the `adapter.config` object).
 *
 * These values mirror the defaults declared in `io-package.json` and control how the WebSocket
 * server is exposed and secured.
 */
export interface WsConfig {
    /** TCP port the web server listens on (io-package default: `8084`). */
    port: number | string;
    /** Whether clients must authenticate. When `false`, requests run as {@link WsConfig.defaultUser}. */
    auth: boolean;
    /** Whether to serve over HTTPS/TLS (uses the `cert*` fields below) instead of plain HTTP. */
    secure: boolean;
    /** IP address to bind to; `0.0.0.0` listens on all interfaces. */
    bind: string;
    /** Session time-to-live in seconds (io-package default: `3600`). */
    ttl: number | string;
    /** Name of the stored public certificate to use when {@link WsConfig.secure} is set. */
    certPublic: string;
    /** Name of the stored private key to use when {@link WsConfig.secure} is set. */
    certPrivate: string;
    /** Name of the stored chained (intermediate) certificate, if any. */
    certChained: string;
    /** User the server acts as for unauthenticated requests (io-package default: `admin`). */
    defaultUser: string;
    /** Whether Let's Encrypt certificate handling is enabled. */
    leEnabled: boolean;
    /** Whether Let's Encrypt certificates should be renewed automatically. */
    leUpdate: boolean;
    /** UI language used for localized responses. */
    language: ioBroker.Languages;
    /** Port used for the Let's Encrypt ACME challenge (io-package default: `80`). */
    leCheckPort: number | string;
}
