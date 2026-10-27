import { S3Client, HeadBucketCommand, CreateBucketCommand, PutObjectCommand, GetObjectCommand,
  HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../shared/http.mjs';

export const UPLOAD_TTL_SECONDS = 300;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg' };

function clientFor(endpoint, credentials) {
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/') throw new Error('MinIO endpoint không hợp lệ.');
  return new S3Client({ endpoint: url.href, region: 'us-east-1', forcePathStyle: true,
    credentials, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
}

export function validImage(bytes, contentType) {
  if (contentType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return contentType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function createStorage({ endpoint, publicEndpoint, accessKey, secretKey, bucket }) {
  const credentials = { accessKeyId: accessKey, secretAccessKey: secretKey };
  const client = clientFor(endpoint, credentials);
  // Sign for the hostname used by the browser, not the Docker-only hostname.
  const publicClient = clientFor(publicEndpoint, credentials);
  return {
    async init() {
      try { await client.send(new HeadBucketCommand({ Bucket: bucket })); }
      catch (error) {
        if (error.$metadata?.httpStatusCode !== 404) throw error;
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      }
      // Bucket has no anonymous policy. Files require signed URLs.
    },
    async uploadUrl(key) { return getSignedUrl(publicClient, new PutObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: UPLOAD_TTL_SECONDS }); },
    async readUrl(key) { return getSignedUrl(publicClient, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: UPLOAD_TTL_SECONDS }); },
    async finalize(key, userId, contentType) {
      const metadata = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).catch(error => {
        if (error.$metadata?.httpStatusCode === 404) throw new HttpError(400, 'UPLOAD_NOT_FOUND', 'Chưa tìm thấy file đã upload.');
        throw error;
      });
      if (metadata.ContentLength < 8 || metadata.ContentLength > MAX_AVATAR_BYTES) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        throw new HttpError(400, 'INVALID_IMAGE_SIZE', 'Ảnh phải có kích thước tối đa 5 MiB.');
      }
      const { Body: stream } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const chunks = [];
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX_AVATAR_BYTES) {
          stream.destroy();
          throw new HttpError(400, 'INVALID_IMAGE_SIZE', 'Ảnh vượt quá 5 MiB.');
        }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (!validImage(bytes, contentType)) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        throw new HttpError(400, 'INVALID_IMAGE', 'Chữ ký file không khớp định dạng ảnh.');
      }
      // Copy the checked bytes to a new key. A still-valid PUT URL cannot change the approved avatar.
      const finalKey = `approved/${userId}/${randomUUID()}.${AVATAR_TYPES[contentType]}`;
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: finalKey, Body: bytes, ContentType: contentType }));
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return finalKey;
    },
  };
}
