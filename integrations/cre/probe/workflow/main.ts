// Minimal official quickstart shape; this is a Phase 1 probe, not the incident workflow.
import { CronCapability, handler, Runner, type Runtime } from '@chainlink/cre-sdk';
type Config = { schedule: string };
const onCron = (runtime: Runtime<Config>): string => {
  runtime.log('Rooted Phase 1 simulation');
  return 'Rooted Phase 1 simulation';
};
export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(config => [handler(new CronCapability().trigger({schedule: config.schedule}), onCron)]);
}
