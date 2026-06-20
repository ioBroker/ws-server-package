import { writeFileSync, readFileSync, copyFileSync} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const req = createRequire(import.meta.url);
const _dirname = dirname(fileURLToPath(import.meta.url));

const socket = req.resolve('@iobroker/ws').replace(/\\/g, '/');

writeFileSync(`${_dirname}/build/lib/socket.io.js`, readFileSync(socket));
copyFileSync(`${_dirname}/src/types.d.ts`, `${_dirname}/build/types.d.ts`);
