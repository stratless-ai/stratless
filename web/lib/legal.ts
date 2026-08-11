// Single source of truth for the legal pages (/privacy, /terms).
//
// stratless is now a LOCAL CLI: no server, no account, no key, no payment, no data collection.
// That makes both documents short and mostly true by construction rather than by promise —
// there is no infrastructure to misbehave. Keep them that way.
export const legal = {
  operator: 'stratless',
  site: 'stratless.com',
  // How Sun operates — individual, pre-incorporation. Swap to the company at first sales (+ a
  // lawyer pass then).
  entity: 'its author as an individual',
  jurisdiction: 'Malaysia',
  email: 'sun@stratless.com',
  license: 'MIT',
  source: 'https://github.com/stratless-ai/stratless',
  effectiveDate: 'August 11, 2026',
}
