import { readFile } from 'node:fs/promises';
import { importSPKI } from 'jose';
import { createGateway } from './app.mjs';
import { listen, required } from '../shared/http.mjs';
import { JWT_ALGORITHM } from '../shared/jwt.mjs';

const publicKey = await importSPKI(await readFile(required('JWT_PUBLIC_KEY_FILE'), 'utf8'), JWT_ALGORITHM);
listen(createGateway({ userUrl: required('USER_URL'), orderUrl: required('ORDER_URL'),
  internalKey: required('INTERNAL_API_KEY'), publicKey }), Number(process.env.GATEWAY_PORT || 8080), process.env.HOST || '127.0.0.1');
