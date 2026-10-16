insert into public.developify_collection_versions (collection, version)
values
  ('adminUsers', 0),
  ('auditLogs', 0),
  ('authChallenges', 0),
  ('chatMessages', 0),
  ('deviceInstallations', 0),
  ('documents', 0),
  ('favourites', 0),
  ('investmentMilestones', 0),
  ('investmentQuotes', 0),
  ('investments', 0),
  ('investorEntities', 0),
  ('kycDrafts', 0),
  ('kycInvites', 0),
  ('kycMembers', 0),
  ('landownerPayouts', 0),
  ('ledgerAccounts', 0),
  ('ledgerEntries', 0),
  ('memberships', 0),
  ('notifications', 0),
  ('paymentMethods', 0),
  ('payoutAccounts', 0),
  ('projects', 0),
  ('properties', 0),
  ('refreshTokens', 0),
  ('searchHistories', 0),
  ('securityPreferences', 0),
  ('submissionDrafts', 0),
  ('systemConfigs', 0),
  ('systemCounters', 0),
  ('transactions', 0),
  ('userPreferences', 0),
  ('users', 0)
on conflict (collection) do nothing;

insert into public.developify_migrations (version)
values ('003_register_firestore_collections')
on conflict (version) do nothing;
