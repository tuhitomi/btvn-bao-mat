import { readFile } from 'node:fs/promises';
import { importPKCS8 } from 'jose';
import { createUserService } from './app.mjs';
import { createStorage } from './storage.mjs';
import { listen, required } from '../shared/http.mjs';
import { JWT_ALGORITHM } from '../shared/jwt.mjs';

const privateKey = await importPKCS8(await readFile(required('JWT_PRIVATE_KEY_FILE'), 'utf8'), JWT_ALGORITHM);
const storage = createStorage({ endpoint: required('MINIO_ENDPOINT'), publicEndpoint: required('MINIO_PUBLIC_ENDPOINT'),
  accessKey: required('MINIO_ROOT_USER'), secretKey: required('MINIO_ROOT_PASSWORD'), bucket: required('MINIO_BUCKET') });
await storage.init();
listen(createUserService({ internalKey: required('INTERNAL_API_KEY'), privateKey,
  password: required('DEMO_PASSWORD'), storage }), Number(process.env.USER_PORT || 3001), process.env.HOST || '127.0.0.1');
