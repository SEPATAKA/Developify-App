export enum EntityType {
  individual = 'individual',
  company = 'company',
  trust = 'trust',
  stokvel = 'stokvel',
}

export enum VerificationStatus {
  incomplete = 'incomplete',
  pending = 'pending',
  correctionRequired = 'correctionRequired',
  verified = 'verified',
}

export enum PropertyStatus {
  draft = 'draft',
  underReview = 'underReview',
  offerReady = 'offerReady',
  live = 'live',
  paused = 'paused',
}

export enum ProjectStatus {
  open = 'open',
  funded = 'funded',
  closed = 'closed',
}

export enum TransactionKind {
  investment = 'investment',
  distribution = 'distribution',
  topUp = 'topUp',
  withdrawal = 'withdrawal',
  refund = 'refund',
}

export enum TransactionStatus {
  successful = 'successful',
  pending = 'pending',
  failed = 'failed',
}

export enum InvestmentStatus {
  active = 'active',
  completed = 'completed',
  underfunded = 'underfunded',
}

export enum PaymentMethodKind {
  card = 'card',
  bankAccount = 'bankAccount',
}

export enum LedgerAccountType {
  userWallet = 'userWallet',
  heldPrincipal = 'heldPrincipal',
  platformClearing = 'platformClearing',
  feeRevenue = 'feeRevenue',
  projectCapacity = 'projectCapacity',
}
