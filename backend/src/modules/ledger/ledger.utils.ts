import { InternalServerErrorException } from '@nestjs/common';

export function assertBalancedLedger(entries: { amountCents: bigint }[]) {
  const sum = entries.reduce((total, entry) => total + entry.amountCents, 0n);
  if (sum !== 0n) {
    throw new InternalServerErrorException(
      'Ledger batch is not balanced and was not posted.',
    );
  }
}
