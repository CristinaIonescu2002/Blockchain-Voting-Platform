import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Address } from '@multiversx/sdk-core';
import axios from 'axios';
import { ChainService } from './chain/chain.service';
import { BuildVoteTxDto } from './dto/build-vote-tx.dto';
import { SubmitSignedVoteIntentDto, SubmitVoteTxDto } from './dto/submit-vote-tx.dto';
import { SubmitSignedTxDto } from './dto/submit-signed-tx.dto';

@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);
  private readonly voteServiceUrl: string;
  private readonly assocServiceUrl: string;
  private readonly internalApiToken: string;

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
    this.internalApiToken = config.get('INTERNAL_API_TOKEN', 'dev-internal-token');
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
    maxChoices: bigint;
    candidateWallets: string[];
    eligibleVoterWallets: string[];
    senderBech32: string;
  }): Promise<object> {
    const nonce = await this.chain.getAccountNonce(params.senderBech32);
    // #[allow_multiple_var_args] requires a u32 count prefix before each variadic group
    const args = [
      this.chain.encodeU64(params.scAssocId),
      Buffer.from(params.title).toString('hex'),
      this.chain.encodeU64(params.deadlineTimestamp),
      this.chain.encodeU64(params.quorum),
      this.chain.encodeU64(params.maxChoices),
      this.chain.encodeU64(BigInt(params.candidateWallets.length)),
      this.chain.encodeU64(BigInt(params.eligibleVoterWallets.length)),
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
    const scAssocId = BigInt(dto.scAssocId);
    const scSessionId = BigInt(dto.scSessionId);
    const [status, deadline] = await Promise.all([
      this.chain.getSessionStatus(scAssocId, scSessionId),
      this.chain.getSessionDeadline(scAssocId, scSessionId),
    ]);

    if (status !== 0) {
      throw new BadRequestException(
        `On-chain session ${dto.scSessionId} is not open (status ${status}). The local session may be linked to the wrong on-chain session ID.`,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    if (deadline <= now) {
      throw new BadRequestException(
        `Session deadline has passed (on-chain deadline: ${deadline}, current time: ${now})`,
      );
    }

    // Bridge fetches the voter's current nonce from chain — voter supplies nothing extra
    const nonce = await this.chain.getAccountNonce(dto.voterWallet);
    const candidateWallets = dto.candidateWallets?.length
      ? dto.candidateWallets
      : dto.candidateWallet
        ? [dto.candidateWallet]
        : [];
    const relayer =
      this.chain.bridgeAddress &&
      this.chain.getShardOfAddress(this.chain.bridgeAddress) ===
        this.chain.getShardOfAddress(dto.voterWallet)
        ? this.chain.bridgeAddress
        : undefined;
    const data = this.chain.buildScData('castVote', [
      this.chain.encodeU64(scAssocId),
      this.chain.encodeU64(scSessionId),
      ...candidateWallets.map((wallet) => this.chain.encodeAddress(wallet)),
    ]);
    return this.chain.buildUnsignedTxObject({
      sender: dto.voterWallet,
      receiver: this.chain.contractAddress,
      data,
      gasLimit: this.GAS.castVote + (relayer ? 50_000 : 0),
      nonce,
      relayer,
    });
  }

  // ─── Submit admin signed tx, forward to chain ───────────────────────────

  async submitAdminTx(
    dto: SubmitSignedTxDto,
  ): Promise<{ txHash: string; scAssocId?: number; scSessionId?: number }> {
    const stopOnly = dto.sessionSyncStatus === 'stopped';

    let previousAssocCount: number | null = null;
    let previousSessionCount: number | null = null;

    if (dto.associationId) {
      try {
        previousAssocCount = await this.chain.getAssocCount();
      } catch (e) {
        this.logger.warn('Could not read assocCount before tx submission', e);
      }
    }

    if (dto.sessionId && dto.scAssocId && !stopOnly) {
      try {
        previousSessionCount = await this.chain.getSessionCount(BigInt(dto.scAssocId));
      } catch (e) {
        this.logger.warn('Could not read sessionCount before tx submission', e);
      }
    }

    const txHash = await this.chain.forwardSignedTx(dto.signedTx);
    this.logger.log(`Admin tx submitted: ${txHash}`);

    let returnedId: number | null = null;
    try {
      if (stopOnly) {
        await this.chain.waitForSuccess(txHash);
      } else {
        returnedId = await this.chain.waitForReturnU64(txHash);
      }
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    let resolvedScAssocId: number | null = null;
    let resolvedScSessionId: number | null = null;

    if (dto.associationId) {
      try {
        resolvedScAssocId =
          returnedId ??
          (await this.chain.getIndexedEventU64(txHash, 'associationRegistered', 0)) ??
          (await this.resolveAssocIdAfterCreate(previousAssocCount));
      } catch (e) {
        this.logger.warn('Could not resolve assocCount after tx confirmation', e);
      }
    }

    if (dto.sessionId && dto.scAssocId && !stopOnly) {
      try {
        resolvedScSessionId =
          returnedId ??
          (await this.chain.getNestedEventTopicU64(
            txHash,
            'createVotingSession',
            'sessionCreated',
            2,
          )) ??
          (await this.resolveSessionIdAfterCreate(
            BigInt(dto.scAssocId),
            previousSessionCount,
          ));
      } catch (e) {
        this.logger.warn('Could not resolve sessionCount after tx confirmation', e);
      }
    }

    if (dto.associationId && resolvedScAssocId === null) {
      throw new BadRequestException(
        `Transaction ${txHash} succeeded but the association ID could not be resolved`,
      );
    }

    if (dto.sessionId && dto.scAssocId && !stopOnly && resolvedScSessionId === null) {
      throw new BadRequestException(
        `Transaction ${txHash} succeeded but the session ID could not be resolved`,
      );
    }

    if (dto.associationId && resolvedScAssocId !== null) {
      await this.patchAssociation(dto.associationId, resolvedScAssocId);
    }

    if (dto.sessionId && resolvedScSessionId !== null) {
      await this.patchSessionScId(dto.sessionId, resolvedScSessionId);
    }

    if (stopOnly && dto.sessionId) {
      await this.patchSessionStatus(dto.sessionId, 'stopped');
    }

    return {
      txHash,
      ...(resolvedScAssocId !== null && { scAssocId: resolvedScAssocId }),
      ...(resolvedScSessionId !== null && { scSessionId: resolvedScSessionId }),
    };
  }

  // ─── Submit voter's signed inner tx as relayed vote ──────────────────────

  async submitVote(dto: SubmitVoteTxDto): Promise<{ txHash: string }> {
    const signedTx = dto.signedInnerTx as Record<string, unknown>;
    const txHash = signedTx.relayer
      ? await this.chain.wrapAndSendRelayed(dto.signedInnerTx)
      : await this.chain.forwardSignedTx(dto.signedInnerTx);
    this.logger.log(
      `${signedTx.relayer ? 'Relayed' : 'Direct'} vote tx: ${txHash} for session ${dto.sessionId}`,
    );

    try {
      await this.chain.waitForSuccess(txHash);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    const voterWallet = signedTx.sender as string;
    const dataB64 = signedTx.data as string;
    const dataStr = Buffer.from(dataB64, 'base64').toString();
    const parts = dataStr.split('@');
    const candidateWallets = parts
      .slice(3)
      .map((hex) => this.hexToAddress(hex))
      .filter(Boolean);

    if (candidateWallets.length > 0) {
      await this.notifyVoteRecorded(dto.sessionId, voterWallet, candidateWallets);
    }

    return { txHash };
  }

  async submitVoteIntent(dto: SubmitSignedVoteIntentDto): Promise<{ txHash: string }> {
    if (dto.candidateWallets.length === 0) {
      throw new BadRequestException('Select at least one candidate');
    }

    const paymaster = await this.getAssociationPaymaster(dto.associationId);
    const data = this.chain.buildScData('castVoteBySignature', [
      this.chain.encodeU64(BigInt(dto.scAssocId)),
      this.chain.encodeU64(BigInt(dto.scSessionId)),
      this.chain.encodeAddress(dto.voterWallet),
      this.chain.encodeAddress(dto.voterWallet),
      Buffer.from(dto.message, 'utf8').toString('hex'),
      this.normalizeHex(dto.signature),
      ...dto.candidateWallets.map((wallet) => this.chain.encodeAddress(wallet)),
    ]);

    const txHash = await this.chain.buildSignAndSendWithPem({
      pemContent: paymaster.pemContent,
      receiver: this.chain.contractAddress,
      data,
      gasLimit: this.GAS.castVote + 2_000_000,
    });
    this.logger.log(`Paymaster vote tx: ${txHash} for session ${dto.sessionId}`);

    try {
      await this.chain.waitForSuccess(txHash);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    await this.notifyVoteRecorded(dto.sessionId, dto.voterWallet, dto.candidateWallets);

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

    try {
      await this.chain.waitForSuccess(txHash);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    await this.patchSessionStatus(sessionId, 'finalized');

    return { txHash };
  }

  // ─── Internal DB sync helpers ────────────────────────────────────────────

  private async patchAssociation(associationId: string, scAssocId: number) {
    await axios.patch(`${this.assocServiceUrl}/associations/${associationId}/sc-sync`, {
      scAssocId,
    });
  }

  private async patchSessionScId(sessionId: string, scSessionId: number) {
    await axios.patch(`${this.voteServiceUrl}/votes/sessions/${sessionId}/sc-sync`, {
      scSessionId,
      status: 'open',
    });
  }

  private async notifyVoteRecorded(
    sessionId: string,
    voterWallet: string,
    candidateWallets: string[],
  ) {
    await axios.post(`${this.voteServiceUrl}/votes/sessions/${sessionId}/record-vote`, {
      voterWallet,
      candidateWallets,
    });
  }

  private async patchSessionStatus(sessionId: string, status: string) {
    await axios.patch(`${this.voteServiceUrl}/votes/sessions/${sessionId}/sc-sync`, { status });
  }

  private async getAssociationPaymaster(
    associationId: string,
  ): Promise<{ walletAddress: string; pemContent: string }> {
    const { data } = await axios.get(
      `${this.assocServiceUrl}/associations/${associationId}/paymaster/internal`,
      {
        headers: { 'x-internal-token': this.internalApiToken },
      },
    );
    return data as { walletAddress: string; pemContent: string };
  }

  private normalizeHex(value: string): string {
    const hex = value.startsWith('0x') ? value.slice(2) : value;
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      throw new BadRequestException('Invalid hex signature');
    }
    return hex.length % 2 === 0 ? hex.toLowerCase() : `0${hex.toLowerCase()}`;
  }

  private async resolveAssocIdAfterCreate(previousCount: number | null): Promise<number> {
    for (let i = 0; i < 10; i++) {
      const currentCount = await this.chain.getAssocCount();
      if (previousCount === null || currentCount > previousCount) {
        return currentCount;
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    throw new Error('Association ID was not visible in contract views after confirmation');
  }

  private async resolveSessionIdAfterCreate(
    scAssocId: bigint,
    previousCount: number | null,
  ): Promise<number> {
    for (let i = 0; i < 10; i++) {
      const currentCount = await this.chain.getSessionCount(scAssocId);
      if (previousCount === null || currentCount > previousCount) {
        return currentCount;
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    throw new Error('Session ID was not visible in contract views after confirmation');
  }

  private hexToAddress(hex: string): string {
    try {
      // MultiversX address is 32 bytes hex → bech32
      return Address.newFromHex(hex).toBech32();
    } catch {
      return '';
    }
  }
}
