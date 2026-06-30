import * as anchor from '@project-serum/anchor';
import { Program } from '@project-serum/anchor';
import { Web3Zapier } from '../target/types/web3_zapier';

describe('web3-zapier', () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Web3Zapier as Program<Web3Zapier>;

  it('Is initialized!', async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log('Your transaction signature', tx);
  });
});
