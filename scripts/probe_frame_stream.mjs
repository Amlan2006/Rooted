// Phase 1 read-only, bounded frame stream probe. Node 24+; no npm dependency.
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = process.env.ROOTED_PHASE1_RUN || `${Date.now()}-${randomUUID()}`;
if (!/^[A-Za-z0-9_-]{1,100}$/.test(run)) throw Error('invalid_run_identity');
const output = resolve(root, '.tools', 'phase1', run, 'frame_stream');
mkdirSync(output, { recursive: true });
const destination = resolve(output, 'result.json');
const gateway = process.env.ROOTED_FRAME_GATEWAY_URL || 'https://altmempoolgateway.forshtat.com/rpc';
const execution = process.env.ROOTED_FRAME_EXECUTION_URL || 'https://altmempool.forshtat.com';
const genesis = (process.env.ROOTED_FRAME_GENESIS_HASH ||
  '0x2ad3f67b059fbde111ad7af27cfb4955d997351579612237ca0318937a5bae7a').toLowerCase();

async function rpc(url, method, params) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error('frame_http_unavailable');
  const data = await response.json();
  if (data.error || data.result == null) throw Error('frame_rpc_unavailable');
  return data.result;
}

async function observe() {
  const [chain, info, executionChain, block] = await Promise.all([
    rpc(gateway, 'eth_chainId', []), rpc(gateway, 'skandha_explorer_info', []),
    rpc(execution, 'eth_chainId', []), rpc(execution, 'eth_getBlockByNumber', ['0x0', false]),
  ]);
  if (BigInt(chain) !== 1337n || BigInt(executionChain) !== 1337n ||
      info.chainId !== 1337 || info.protocolVersion !== 1 || block.hash !== genesis) throw Error('frame_identity_mismatch');
  const url = new URL(gateway);
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('invalid_endpoint');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new Promise(resolveResult => {
    const socket = new WebSocket(url);
    let acknowledged = false;
    let events = 0;
    let finished = false;
    const messages = [];
    const finish = reason => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      const completed = ['bounded_10_second_observation', 'bounded_20_events'].includes(reason);
      resolveResult({ status: acknowledged && completed ? 'passed' : 'blocked', reason,
        subscription_acknowledged: acknowledged, replayed_events: events,
        identity_verified: true, source_origin: url.origin, messages });
    };
    const timer = setTimeout(() => finish('bounded_10_second_observation'), 10000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1,
      method: 'skandha_subscribe', params: ['explorerEvents', 0] })));
    socket.addEventListener('message', event => {
      const text = String(event.data);
      if (text.length > 1024 * 1024) return finish('oversized_event');
      try {
        const message = JSON.parse(text);
        if (messages.length < 25) messages.push(message);
        if (message.id === 1 && typeof message.result === 'string') acknowledged = true;
        if (message.error) return finish('subscription_rpc_error');
        if (message.method === 'skandha_subscription') events++;
        if (events >= 20) finish('bounded_20_events');
      } catch { finish('malformed_event'); }
    });
    socket.addEventListener('error', () => finish('websocket_unavailable'));
    socket.addEventListener('close', () => finish('connection_closed'));
  });
}

let report;
try { report = await observe(); }
catch (error) { report = { status: 'blocked', reason: error.message === 'frame_identity_mismatch'
  ? 'frame_identity_mismatch' : 'frame_network_or_identity_unavailable' }; }
report = { schema: 'rooted.phase1-probe-v1', probe: 'frame_stream', checked_at: new Date().toISOString(),
  mode: 'live_probe_attempt', ...report };
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ probe: 'frame_stream', status: report.status, reason: report.reason }));
process.exitCode = report.status === 'passed' ? 0 : 1;
