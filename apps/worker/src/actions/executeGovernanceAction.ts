import type { ActionHandler } from './types';
import { callGovernanceCycle } from '../anchorProgram';

/**
 * Carry out a governance proposal on-chain via our web3_zapier program:
 * create the proposal, vote to approve it, and execute it. A unique proposal id
 * is derived from `proposal` (label) so repeated runs don't collide.
 */
export const executeGovernanceAction: ActionHandler = async (config) => {
  const label = ((config.proposal as string) || 'proposal').replace(/\s+/g, '_').slice(0, 20);
  const id = `${label}-${Date.now().toString(36)}`;
  const description = (config.description as string) || `Proposal ${label}`;

  const { proposal, executeUrl } = await callGovernanceCycle(id, description);
  return `Proposal "${id}" created, approved and executed on-chain (${proposal.slice(0, 8)}…) — ${executeUrl}`;
};
