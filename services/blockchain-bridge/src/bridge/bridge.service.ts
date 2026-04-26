import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ChainService } from './chain/chain.service';
import { BuildVoteTxDto } from './dto/build-vote-tx.dto';
import { SubmitVoteTxDto } from './dto/submit-vote-tx.dto';
import { SubmitSignedTxDto } from './dto/submit-signed-tx.dto';

@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);
  private readonly voteServiceUrl: string;
  private readonly assocServiceUrl: string;

  // Gas limits for each SC call
  private readonly GAS = {
    registerAssociation: 5_000_000,
    registerMember: 5_000_000,
    createVotingSession: 20_000_000,
    castVote: 10_000_000,
    stopSession: 5_000_000,
    finalizeSession: 10_000_000,
  };

  constructor(
    private readonly chain: ChainService,
    private readonly config: ConfigService,
  ) {
    this.voteServiceUrl = config.get('VOTE_SERVICE_URL', 'http://vote-service:3003');
    this.assocServiceUrl = config.get('ASSOC_SERVICE_URL', 'http://association-service:3002');
  }

  // ─── Unsigned tx builders ────────────────────────────────────────────────

  async buildRegisterAssociationTx(name: string, senderBech32: string): Promise<object> {
    const nonce = await this.chain.getAccountNonce(senderBech32);
    const data = this.chain.buildScData('registerAssociation', [
      Buffer.from(name).toString('hex'),
    ]);
    return this.chain.buildUnsignedTxObject({
      sender: senderBech32,
      receiver: this.chain.contractAddress,
      data,
      gasLimit: this.GAS.registerAssociation,
      nonce,
    });
  }

  async buildRegisterMemberTx(
    scAssocId: bigint,
    memberWallet: string,
    senderBech32: string,
  ): Promise<object> {
    const nonce = await this.chain.getAccountNonce(senderBech32);
    const data = this.chain.buildScData('registerMember', [
      this.chain.encodeU64(scAssocId),
      this.chain.encodeAddress(memberWallet),
    ]);
    return this.chain.buildUnsignedTxObject({
      sender: senderBech32,
      receiver: this.chain.contractAddress,
      data,
      gasLimit: this.GAS.registerMember,
      nonce,
    });
  }

  async buildCreateSessionTx(params: {
    scAssocId: bigint;
    title: string;
    deadlineTimestamp: bigint;
    quorum: bigint;
    candidateWallets: string[];
    eligibleVoterWallets: string[];
    senderBech32: string;
  }): Promise<object> {
    const nonce = await this.chain.getAccountNonce(params.senderBech32);
    const args = [
      this.chain.encodeU64(params.scAssocId),
      Buffer.from(params.title).toString('hex'),
      this.chain.encodeU64(params.deadlineTimestamp),
      this.chain.encodeU64(params.quorum),
      ...params.candidateWallets.map((w) => this.chain.encodeAddress(w)),
      ...params.eligibleVoterWallets.map((w) => this.chain.encodeAddress(w)),
    ];
    const data = this.chain.buildScData('createVotingSession', args);
    return this.chain.buildUnsignedTxObject({
      sender: params.senderBech32,
      receiver: this.chain.contractAddress,
      data,
      gasLimit: this.GAS.createVotingSession,
      nonce,
    });
  }

  async buildStopSessionTx(
    scAssocId: bigint,
    scSessionId: bigint,
    senderBech32: string,
  ): Promise<object> {
    const nonce = await this.chain.getAccountNonce(senderBech32);
    const data = this.chain.buildScData('stopSession', [
      this.chain.encodeU64(scAssocId),
      this.chain.encodeU64(scSessionId),
    ]);
    return this.chain.buildUnsignedTxObject({
      sender: senderBech32,
      receiver: this.chain.contractAddress,
      data,
      gasLimit: this.GAS.stopSession,
      nonce,
    });
  }

  // ─── Unsigned castVote inner tx for voter ────────────────────────────────

  async buildVoteTx(dto: BuildVoteTxDto): Promise<object> {
    const data = this.chain.buildScData('castVote', [
      this.chain.encodeU64(BigInt(dto.scAssocId)),
      this.chain.encodeU64(BigInt(dto.scSessionId)),
      this.chain.encodeAddress(dto.candidateWallet),
    ]);
    return this.chain.buildUnsignedTxObject({
      sender: dto.voterWallet,
      receiver: this.chain.contractAddress,
      data,
      gasLimit: this.GAS.castVote,
      nonce: Number(dto.voterNonce),
    });
  }

  // ─── Submit admin signed tx, forward to chain ───────────────────────────

  async submitAdminTx(dto: SubmitSignedTxDto): Promise<{ txHash: string }> {
    const txHash = await this.chain.forwardSignedTx(dto.signedTx);
    this.logger.log(`Admin tx submitted: ${txHash}`);
    return { txHash };
  }

  // ─── Submit voter's signed inner tx as relayed vote ──────────────────────

  async submitVote(dto: SubmitVoteTxDto): Promise<{ txHash: string }> {
    const txHash = await this.chain.wrapAndSendRelayed(dto.signedInnerTx);
    this.logger.log(`Relayed vote tx: ${txHash} for session ${dto.sessionId}`);

    // Async: record vote in vote-service after short delay (tx propagation)
    // In production this would be an event listener / webhook
    const inner = dto.signedInnerTx as Record<string, unknown>;
    const voterWallet = inner.sender as string;
    const dataB64 = inner.data as string;
    const dataStr = Buffer.from(dataB64, 'base64').toString();
    const parts = dataStr.split('@');
    const candidateHex = parts[3] ?? '';
    const candidateWallet = candidateHex
      ? this.hexToAddress(candidateHex)
      : '';

    if (candidateWallet) {
      setTimeout(() => {
        this.notifyVoteRecorded(dto.sessionId, voterWallet, candidateWallet).catch((e) =>
          this.logger.error('Failed to record vote in DB', e),
        );
      }, 8_000); // wait ~2 blocks
    }

    return { txHash };
  }

  // ─── Bridge-signed finalize (anyone can call on-chain) ───────────────────

  async finalizeSession(scAssocId: bigint, scSessionId: bigint, sessionId: string): Promise<{ txHash: string }> {
    const data = this.chain.buildScData('finalizeSession', [
      this.chain.encodeU64(scAssocId),
      this.chain.encodeU64(scSessionId),
    ]);
    const txHash = await this.chain.buildSignAndSend({
      receiver: this.chain.contractAddress,
      data,
      gasLimit: this.GAS.finalizeSession,
    });

    // Update vote-service status after propagation
    setTimeout(() => {
      this.patchSessionStatus(sessionId, 'finalized').catch((e) =>
        this.logger.error('Failed to update session status', e),
      );
    }, 8_000);

    return { txHash };
  }

  // ─── Internal DB sync helpers ────────────────────────────────────────────

  private async notifyVoteRecorded(
    sessionId: string,
    voterWallet: string,
    candidateWallet: string,
  ) {
    await axios.post(`${this.voteServiceUrl}/votes/sessions/${sessionId}/record-vote`, {
      voterWallet,
      candidateWallet,
    });
  }

  private async patchSessionStatus(sessionId: string, status: string) {
    await axios.patch(`${this.voteServiceUrl}/votes/sessions/${sessionId}`, { status });
  }

  private hexToAddress(hex: string): string {
    try {
      // MultiversX address is 32 bytes hex → bech32
      const { Address } = require('@multiversx/sdk-core');
      return Address.fromHex(hex).toBech32();
    } catch {
      return '';
    }
  }
}
