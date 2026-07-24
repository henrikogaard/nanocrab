/**
 * Security proof matrix doctor command.
 *
 * Builds the proof matrix from the live host state and prints a readout.
 * Exits non-zero when any claim is `unproven` or `failed` so this can be
 * used as a CI gate or post-deploy check.
 *
 *   npx tsx scripts/security-proof.ts
 *   npx tsx scripts/security-proof.ts --strict   # also fail on shipped
 */
import { buildProofMatrix } from '../src/security-proof-matrix.js';

const strict = process.argv.includes('--strict');

function main() {
  const matrix = buildProofMatrix();
  console.log(`Security proof matrix — ${matrix.generatedAt}`);
  console.log(
    `Summary: proven=${matrix.summary.proven} shipped=${matrix.summary.shipped} unproven=${matrix.summary.unproven} failed=${matrix.summary.failed}`,
  );
  if (strict) {
    console.log('(strict mode: shipped claims are treated as warnings)');
  }
  console.log('');
  for (const proof of matrix.proofs) {
    const marker =
      proof.status === 'proven'
        ? '[PASS]'
        : proof.status === 'shipped'
          ? '[SHIPPED]'
          : proof.status === 'failed'
            ? '[FAIL]'
            : '[UNPROVEN]';
    console.log(`${marker} #${proof.issue} ${proof.claimId} — ${proof.status}`);
    console.log(`    claim: ${proof.claim}`);
    for (const line of proof.evidence) {
      console.log(`    evidence: ${line}`);
    }
    if (proof.operatorAction) {
      console.log(`    action: ${proof.operatorAction}`);
    }
    console.log('');
  }

  const blocking = matrix.summary.unproven + matrix.summary.failed;
  if (blocking > 0) {
    console.error(
      `security-proof: ${blocking} claim(s) are unproven or failed. See operator actions above.`,
    );
    process.exit(1);
  }
  if (strict && matrix.summary.shipped > 0) {
    console.error(
      `security-proof: ${matrix.summary.shipped} claim(s) are shipped but not proven (strict mode). Run operator actions to reach proven status.`,
    );
    process.exit(1);
  }
  console.log('security-proof: all shipped/proven claims are in good shape.');
  process.exit(0);
}

main();
