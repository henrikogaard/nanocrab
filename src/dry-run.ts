export function isDryRunMode(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.NANOCRAB_DRY_RUN || '');
}

export function dryRunLabel(action: string): string {
  return `Dry-run mode: ${action} was evaluated but not executed.`;
}
