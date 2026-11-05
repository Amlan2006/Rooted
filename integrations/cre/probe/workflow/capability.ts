// Phase 1 read-only capability proof. This is not the Phase 7 incident workflow.
import {
  CronCapability, HTTPClient, EVMClient, handler, consensusMedianAggregation,
  Runner, type NodeRuntime, type Runtime, getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER, encodeCallMsg, bytesToHex,
} from '@chainlink/cre-sdk';

type Config = {
  schedule: string;
  apiUrl: string;
  chainName: string;
  factory: `0x${string}`;
  feeAmountTickSpacingCall: `0x${string}`;
};

const fetchValue = (runtime: NodeRuntime<Config>): bigint => {
  const response = new HTTPClient().sendRequest(runtime, {
    url: runtime.config.apiUrl,
    method: 'GET',
  }).result();
  if (response.statusCode !== 200) throw new Error('HTTP capability returned non-200 status');
  return BigInt(new TextDecoder().decode(response.body).trim());
};

const run = (runtime: Runtime<Config>): string => {
  const value = runtime.runInNodeMode(fetchValue, consensusMedianAggregation())().result();
  if (value !== 4n) throw new Error('Unexpected HTTP result');
  runtime.log(`HTTP_VALUE=${value}`);
  const network = getNetwork({chainFamily: 'evm', chainSelectorName: runtime.config.chainName});
  if (!network) throw new Error('Unsupported chain');
  const response = new EVMClient(network.chainSelector.selector).callContract(runtime, {
    call: encodeCallMsg({
      from: '0x0000000000000000000000000000000000000000',
      to: runtime.config.factory,
      data: runtime.config.feeAmountTickSpacingCall,
    }),
    blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
  }).result();
  // feeAmountTickSpacing(500) returns int24 encoded as a 32-byte word.
  const tickSpacing = BigInt(bytesToHex(response.data));
  if (tickSpacing !== 10n) throw new Error('Unexpected Uniswap factory result');
  runtime.log(`EVM_TICK_SPACING=${tickSpacing}`);
  return JSON.stringify({httpValue: value.toString(), chain: runtime.config.chainName,
    factory: runtime.config.factory, feeAmount: 500, tickSpacing: tickSpacing.toString(),
    mode: 'read-only-simulation'});
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(config => [handler(new CronCapability().trigger({schedule: config.schedule}), run)]);
}
