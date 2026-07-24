/**
 * Egress canary / doctor check for the default-deny agent container network.
 *
 * Proves that an agent container on the isolated network cannot reach an
 * unknown destination, while the host credential/egress proxy remains
 * reachable for approved provider routes. Run after `npm run build` and with
 * the agent container image built (`./container/build.sh`):
 *
 *   npx tsx scripts/egress-canary.ts
 *
 * Exit codes:
 *   0 — default-deny proven (unknown host unreachable)
 *   1 — default-deny NOT enforced (unknown host was reachable) or isolation off
 *   2 — canary could not run (container runtime / image unavailable)
 */
import {
  ensureAgentNetwork,
  ensureContainerRuntimeRunning,
  runEgressCanary,
} from '../src/container-runtime.js';

function main() {
  try {
    ensureContainerRuntimeRunning();
  } catch {
    console.error(
      'egress-canary: container runtime is not available. Start Docker and retry.',
    );
    process.exit(2);
  }

  const network = ensureAgentNetwork();
  if (!network.enabled) {
    console.error(
      `egress-canary: network isolation is not enabled (mode=${
        process.env.CONTAINER_NETWORK_ISOLATION || 'on'
      }). Cannot prove default-deny.`,
    );
    if (network.gatewayIp) {
      console.error(`  network: ${network.name} gateway=${network.gatewayIp}`);
    } else {
      console.error(
        '  On macOS/WSL the --internal topology is not supported; run on bare-metal Linux.',
      );
    }
    process.exit(1);
  }

  console.log(
    `egress-canary: probing unknown host from network "${network.name}" (gateway ${network.gatewayIp})...`,
  );
  const result = runEgressCanary();
  console.log(`  ran:     ${result.ran}`);
  console.log(`  blocked: ${result.blocked}`);
  if (result.output) console.log(`  output:  ${result.output}`);
  if (result.error) console.log(`  error:   ${result.error}`);

  if (!result.ran) {
    process.exit(2);
  }
  if (result.blocked && result.exitCode === 0) {
    console.log('egress-canary: PASS — unknown destination was unreachable.');
    process.exit(0);
  }
  console.error(
    'egress-canary: FAIL — default-deny is not enforced or the canary could not prove it.',
  );
  process.exit(1);
}

main();
