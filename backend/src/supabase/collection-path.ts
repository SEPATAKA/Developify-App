export const SUPABASE_COLLECTIONS = [
  'adminUsers',
  'auditLogs',
  'authChallenges',
  'chatMessages',
  'deviceInstallations',
  'documents',
  'favourites',
  'investmentMilestones',
  'investmentQuotes',
  'investments',
  'investorEntities',
  'kycDrafts',
  'kycInvites',
  'kycMembers',
  'landownerPayouts',
  'ledgerAccounts',
  'ledgerEntries',
  'memberships',
  'notifications',
  'paymentMethods',
  'payoutAccounts',
  'projects',
  'properties',
  'refreshTokens',
  'searchHistories',
  'securityPreferences',
  'submissionDrafts',
  'systemConfigs',
  'systemCounters',
  'transactions',
  'userPreferences',
  'users',
] as const;

const supabaseCollectionSet = new Set<string>(SUPABASE_COLLECTIONS);

export type CollectionTarget = { tableName: string; scope: string };

export function isSupportedCollectionPath(collection: string) {
  const segments = collection.split('/');
  const tableName = segments.at(-1);
  return (
    segments.length % 2 === 1 &&
    !!tableName &&
    supabaseCollectionSet.has(tableName)
  );
}

export function resolveCollectionTarget(collection: string): CollectionTarget {
  if (!isSupportedCollectionPath(collection)) {
    throw new Error(`Unsupported Supabase document collection: ${collection}`);
  }
  const segments = collection.split('/');
  return {
    tableName: segments.at(-1)!,
    scope: segments.slice(0, -1).join('/'),
  };
}
