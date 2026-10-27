import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { gatewayUrl, login, pauseForRateLimit } from './client.mjs';

const samples = Number(process.env.BENCHMARK_SAMPLES || 50);
if (!Number.isInteger(samples) || samples < 5 || samples > 1000) throw new Error('BENCHMARK_SAMPLES phải trong khoảng 5..1000.');
// A preceding E2E burst may have consumed this peer's window. Keep the production limiter active.
await pauseForRateLimit();
const token = await login();
await pauseForRateLimit();
const directUrl = process.env.BENCHMARK_DIRECT_URL || `${process.env.USER_URL}/users/me`;
const directHeaders = { 'x-internal-key': process.env.INTERNAL_API_KEY, 'x-user-id': 'user-1' };
const gatewayHeaders = { authorization: `Bearer ${token}` };
async function measure(url, headers) {
  const start = performance.now();
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  const data = await response.json();
  if (!response.ok || data.id !== 'user-1') throw new Error(`Benchmark aborted: HTTP ${response.status}; không ghi nhận phản hồi lỗi làm số liệu.`);
  return performance.now() - start;
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const round = n => +n.toFixed(3);
  return { samples: values.length, meanMs: round(values.reduce((a, b) => a + b) / values.length),
    p50Ms: round(sorted[Math.ceil(sorted.length * 0.5) - 1]), p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    minMs: round(sorted[0]), maxMs: round(sorted.at(-1)) };
}
// Warm both keep-alive paths; 140ms between iterations stays below the real 10 req/s limit.
for (let i = 0; i < 5; i++) {
  await measure(directUrl, directHeaders);
  await measure(`${gatewayUrl}/users/me`, gatewayHeaders);
  await setTimeout(140);
}
await pauseForRateLimit();
const direct = [], gateway = [];
for (let i = 0; i < samples; i++) {
  // Alternate order to reduce systematic cache / thermal bias.
  if (i % 2 === 0) {
    direct.push(await measure(directUrl, directHeaders));
    gateway.push(await measure(`${gatewayUrl}/users/me`, gatewayHeaders));
  } else {
    gateway.push(await measure(`${gatewayUrl}/users/me`, gatewayHeaders));
    direct.push(await measure(directUrl, directHeaders));
  }
  await setTimeout(140);
}
const directStats = stats(direct), gatewayStats = stats(gateway);
const report = { measuredAt: new Date().toISOString(), samples, runtime: process.version, platform: process.platform,
  topology: process.env.BENCHMARK_TOPOLOGY || 'Running services at configured URLs',
  method: 'Sequential paired requests, alternating order, keep-alive, 5 warm-ups, 140ms pacing, successful responses only',
  direct: directStats, gateway: gatewayStats, meanOverheadMs: +(gatewayStats.meanMs - directStats.meanMs).toFixed(3),
  rawMs: { direct, gateway } };
await mkdir('reports', { recursive: true });
await writeFile('reports/latency.json', JSON.stringify(report, null, 2) + '\n');
await writeFile('reports/latency.csv', 'sample,direct_ms,gateway_ms\n' + direct.map((value, i) => `${i + 1},${value.toFixed(3)},${gateway[i].toFixed(3)}`).join('\n') + '\n');
await writeFile('reports/latency.md', `# Kết quả đo độ trễ\n\nThời điểm: ${report.measuredAt}; ${samples} mẫu mỗi đường đi.\n\nMô hình chạy: ${report.topology}.\n\n| Đường đi | Trung bình (ms) | p50 (ms) | p95 (ms) |\n|---|---:|---:|---:|\n| Trực tiếp User service | ${directStats.meanMs} | ${directStats.p50Ms} | ${directStats.p95Ms} |\n| Qua Gateway + JWT | ${gatewayStats.meanMs} | ${gatewayStats.p50Ms} | ${gatewayStats.p95Ms} |\n\nChênh lệch trung bình: **${report.meanOverheadMs} ms**.\n\nĐây là phép đo cục bộ, tuần tự, có làm nóng kết nối, nghỉ 140 ms giữa các cặp; không phải tải tối đa hoặc độ trễ production. Đường trực tiếp vẫn kiểm tra khóa nội bộ và trả cùng dữ liệu. Chỉ ghi số liệu khi HTTP 200.\n`);
console.table({ direct: directStats, gateway: gatewayStats });
console.info(`Mean overhead: ${report.meanOverheadMs} ms. Reports: reports/latency.{json,csv,md}`);
