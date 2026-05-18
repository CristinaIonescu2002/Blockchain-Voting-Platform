import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Address,
  AddressComputer,
  Transaction,
  TransactionComputer,
  UserSigner,
} from '@multiversx/sdk-core';
import axios from 'axios';
import * as fs from 'fs';

@Injectable()
export class ChainService implements OnModuleInit {
  private readonly logger = new Logger(ChainService.name);

  private signer: UserSigner | null = null;
  private _bridgeAddress: string | null = null;
  private proxyUrl!: string;
  private chainId!: string;
  private _contractAddress!: string;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    this.proxyUrl = this.config.get('MVX_API_URL', 'https://devnet-api.multiversx.com');
    this.chainId = this.config.get('MVX_CHAIN_ID', 'D');
    this._contractAddress = this.config.get('CONTRACT_ADDRESS', '');

    const pemPath = this.config.get<string>('BRIDGE_WALLET_PEM_PATH');
    if (pemPath && fs.existsSync(pemPath)) {
      const pem = fs.readFileSync(pemPath, 'utf8');
      this.signer = UserSigner.fromPem(pem);
      this._bridgeAddress = this.signer.getAddress().toBech32();
      this.logger.log(`Bridge wallet loaded: ${this._bridgeAddress}`);
    } else {
      this.logger.warn(
        'BRIDGE_WALLET_PEM_PATH not set or file not found — relayed txs and bridge-signed calls disabled.',
      );
    }
  }

  get contractAddress(): string {
    return this._contractAddress;
  }

  get bridgeAddress(): string | null {
    return this._bridgeAddress;
  }

  // ─── Network helpers ──────────────────────────────────────────────────────

  async getAccountNonce(address: string): Promise<number> {
    const { data } = await axios.get(`${this.proxyUrl}/accounts/${address}`);
    return Number(data.nonce ?? data?.data?.account?.nonce ?? 0);
  }

  async sendRawTransaction(txObj: object): Promise<string> {
    const { data } = await axios.post(`${this.proxyUrl}/transactions`, txObj);
    const hash = data?.txHash ?? data?.data?.txHash;
    if (!hash) throw new Error(`Send failed: ${JSON.stringify(data)}`);
    return hash;
  }

  // ─── SC view query ────────────────────────────────────────────────────────

  /**
   * MultiversX gateways vary: some return camelCase (`returnData`), others PascalCase
   * (`ReturnData`) and nest output under `data.data`. Missing arrays decode as [] → u64 0.
   */
  private pickVmReturnData(httpBody: unknown): string[] {
    const layers: Record<string, unknown>[] = [];
    const root = httpBody as Record<string, unknown> | undefined;
    if (root) layers.push(root);
    const d1 = root?.data as Record<string, unknown> | undefined;
    if (d1) layers.push(d1);
    const d2 = d1?.data as Record<string, unknown> | undefined;
    if (d2) layers.push(d2);

    const normalizeEntry = (entry: unknown): string | undefined => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const o = entry as Record<string, unknown>;
        if (typeof o.base64 === 'string') return o.base64;
        if (typeof o.asBase64 === 'string') return o.asBase64;
      }
      return undefined;
    };

    for (const layer of layers) {
      const raw = (layer.returnData ?? layer.ReturnData) as unknown;
      if (!Array.isArray(raw)) continue;
      const mapped = raw.map(normalizeEntry).filter((s): s is string => !!s);
      if (mapped.length > 0) return mapped;
    }
    for (const layer of layers) {
      const raw = (layer.returnData ?? layer.ReturnData) as unknown;
      if (Array.isArray(raw)) {
        return raw.map(normalizeEntry).filter((s): s is string => !!s);
      }
    }
    return [];
  }

  private pickVmReturnCode(httpBody: unknown): unknown {
    const root = httpBody as Record<string, unknown> | undefined;
    const d1 = root?.data as Record<string, unknown> | undefined;
    const d2 = d1?.data as Record<string, unknown> | undefined;
    return (
      d2?.returnCode ??
      d2?.ReturnCode ??
      d1?.returnCode ??
      d1?.ReturnCode ??
      root?.returnCode ??
      root?.ReturnCode
    );
  }

  private pickVmReturnMessage(httpBody: unknown): string {
    const root = httpBody as Record<string, unknown> | undefined;
    const d1 = root?.data as Record<string, unknown> | undefined;
    const d2 = d1?.data as Record<string, unknown> | undefined;
    const msg =
      d2?.returnMessage ??
      d2?.ReturnMessage ??
      d1?.returnMessage ??
      d1?.ReturnMessage ??
      root?.returnMessage ??
      root?.ReturnMessage;
    return typeof msg === 'string' ? msg : '';
  }

  private isVmSuccess(returnCode: unknown): boolean {
    return (
      returnCode === undefined ||
      returnCode === null ||
      returnCode === 'ok' ||
      returnCode === 'success' ||
      returnCode === 0
    );
  }

  /** Call a view function on the SC and return raw base64 returnData. */
  async queryView(funcName: string, hexArgs: string[] = []): Promise<string[]> {
    const { data } = await axios.post(`${this.proxyUrl}/vm-values/query`, {
      scAddress: this._contractAddress,
      funcName,
      args: hexArgs,
    });
    const body = data?.data ?? data;
    const returnCode = this.pickVmReturnCode(body);
    const returnMessage = this.pickVmReturnMessage(body);

    if (!this.isVmSuccess(returnCode)) {
      throw new Error(
        `View ${funcName} failed${returnMessage ? `: ${returnMessage}` : ` (${returnCode})`}`,
      );
    }

    return this.pickVmReturnData(body);
  }

  /** Decode a base64 u64 returnData[0] into a JS number. */
  decodeU64ReturnValue(base64: string | undefined): number {
    if (!base64) return 0;
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0) return 0;
    return Number(BigInt('0x' + bytes.toString('hex')));
  }

  decodeBase64Text(base64: string | undefined): string {
    if (!base64) return '';
    return Buffer.from(base64, 'base64').toString('utf8');
  }

  /** Query getAssocCount() → current number of registered associations. */
  async getAssocCount(): Promise<number> {
    const returnData = await this.queryView('getAssocCount');
    return this.decodeU64ReturnValue(returnData[0]);
  }

  /** Query getSessionCount(scAssocId) → current number of sessions for that assoc. */
  async getSessionCount(scAssocId: bigint): Promise<number> {
    const hexArg = scAssocId.toString(16).padStart(16, '0');
    const returnData = await this.queryView('getSessionCount', [hexArg]);
    return this.decodeU64ReturnValue(returnData[0]);
  }

  async getSessionStatus(scAssocId: bigint, scSessionId: bigint): Promise<number> {
    const args = [
      scAssocId.toString(16).padStart(16, '0'),
      scSessionId.toString(16).padStart(16, '0'),
    ];
    const returnData = await this.queryView('getSessionStatus', args);
    return this.decodeU64ReturnValue(returnData[0]);
  }

  async getSessionDeadline(scAssocId: bigint, scSessionId: bigint): Promise<number> {
    const args = [
      scAssocId.toString(16).padStart(16, '0'),
      scSessionId.toString(16).padStart(16, '0'),
    ];
    const returnData = await this.queryView('getSessionDeadline', args);
    return this.decodeU64ReturnValue(returnData[0]);
  }

  async getIndexedEventU64(
    txHash: string,
    identifier: string,
    topicIndex: number,
  ): Promise<number | null> {
    const tx = await this.getTransaction(txHash, true);
    const events = [
      ...(tx?.logs?.events ?? []),
      ...((tx?.smartContractResults ?? []).flatMap(
        (scr: { logs?: { events?: Array<{ identifier?: string; topics?: string[] }> } }) =>
          scr.logs?.events ?? [],
      ) ?? []),
    ];

    for (const event of events) {
      if (event?.identifier !== identifier) continue;
      const topic = event.topics?.[topicIndex];
      if (!topic) return null;
      return this.decodeU64ReturnValue(topic);
    }

    return null;
  }

  async getNestedEventTopicU64(
    txHash: string,
    identifier: string,
    nestedEventName: string,
    topicIndex: number,
  ): Promise<number | null> {
    const tx = await this.getTransaction(txHash, true);
    const events = [
      ...(tx?.logs?.events ?? []),
      ...((tx?.smartContractResults ?? []).flatMap(
        (scr: { logs?: { events?: Array<{ identifier?: string; topics?: string[] }> } }) =>
          scr.logs?.events ?? [],
      ) ?? []),
    ];

    for (const event of events) {
      if (event?.identifier !== identifier) continue;
      const nestedName = this.decodeBase64Text(event.topics?.[0]);
      if (nestedName !== nestedEventName) continue;
      const topic = event.topics?.[topicIndex];
      if (!topic) return null;
      return this.decodeU64ReturnValue(topic);
    }

    return null;
  }

  /**
   * Polls until the tx is confirmed, then parses the first SC return value as u64.
   * Returns null if no return value or timed out. Throws when the tx is confirmed as failed.
   */
  async waitForReturnU64(txHash: string, maxRetries = 15): Promise<number | null> {
    for (let i = 0; i < maxRetries; i++) {
      await new Promise((r) => setTimeout(r, 6_000)); // ~1 block on devnet
      try {
        const tx = await this.getTransaction(txHash, true);
        const status: string = tx?.status ?? '';

        if (status === 'success') {
          const scrs: { data?: string }[] = tx?.smartContractResults ?? [];
          for (const scr of scrs) {
            // MultiversX encodes SC return as @6f6b@<hex_value>  (@ok@<value>)
            if (typeof scr.data === 'string' && scr.data.startsWith('@6f6b@')) {
              const hex = scr.data.slice(6);
              if (hex) return parseInt(hex, 16);
            }
          }

          const txEvents = tx?.logs?.events ?? [];
          for (const event of txEvents) {
            if (typeof event?.data === 'string' && event.data.startsWith('@6f6b@')) {
              const hex = event.data.slice(6);
              if (hex) return parseInt(hex, 16);
            }
          }

          const ops = tx?.operations ?? [];
          for (const op of ops) {
            if (typeof op?.data === 'string' && op.data.startsWith('@6f6b@')) {
              const hex = op.data.slice(6);
              if (hex) return parseInt(hex, 16);
            }
          }
          return null;
        }
        if (status === 'fail' || status === 'invalid') {
          const message =
            tx?.returnMessage ??
            tx?.reason ??
            tx?.error ??
            tx?.smartContractResults?.find((scr: { data?: string }) =>
              typeof scr.data === 'string' && scr.data.length > 0,
            )?.data;
          throw new Error(
            `Transaction ${txHash} failed${message ? `: ${message}` : ` (status: ${status})`}`,
          );
        }
      } catch (err) {
        if ((err as Error).message.includes(`Transaction ${txHash} failed`)) {
          throw err;
        }
        this.logger.warn(`Polling tx ${txHash} attempt ${i + 1}: ${(err as Error).message}`);
      }
    }
    this.logger.warn(`waitForReturnU64: timeout for tx ${txHash}`);
    return null;
  }

  // ─── ABI encoding helpers ─────────────────────────────────────────────────

  /** Polls until the tx is confirmed as success. Throws if the chain confirms failure. */
  async waitForSuccess(txHash: string, maxRetries = 15): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      await new Promise((r) => setTimeout(r, 6_000));
      try {
        const tx = await this.getTransaction(txHash, true);
        const status: string = tx?.status ?? '';

        if (status === 'success') return;
        if (status === 'fail' || status === 'invalid') {
          const message =
            tx?.returnMessage ??
            tx?.reason ??
            tx?.error ??
            tx?.smartContractResults?.find((scr: { data?: string }) =>
              typeof scr.data === 'string' && scr.data.length > 0,
            )?.data;
          throw new Error(
            `Transaction ${txHash} failed${message ? `: ${message}` : ` (status: ${status})`}`,
          );
        }
      } catch (err) {
        if ((err as Error).message.includes(`Transaction ${txHash} failed`)) {
          throw err;
        }
        this.logger.warn(`Polling tx ${txHash} attempt ${i + 1}: ${(err as Error).message}`);
      }
    }
    throw new Error(`Transaction ${txHash} was not confirmed before timeout`);
  }

  encodeU64(n: bigint): string {
    if (n === 0n) return '';
    const hex = n.toString(16);
    return hex.length % 2 === 0 ? hex : '0' + hex;
  }

  encodeAddress(bech32: string): string {
    return Address.newFromBech32(bech32).toHex();
  }

  getShardOfAddress(bech32: string): number {
    return new AddressComputer().getShardOfAddress(Address.newFromBech32(bech32));
  }

  buildScData(fn: string, args: string[]): string {
    return args.length > 0 ? `${fn}@${args.join('@')}` : fn;
  }

  // ─── Unsigned tx builder (for client-side signing) ────────────────────────

  buildUnsignedTxObject(params: {
    sender: string;
    receiver: string;
    data: string;
    gasLimit: number;
    nonce: number;
    relayer?: string;
  }): object {
    return {
      nonce: params.nonce,
      value: '0',
      receiver: params.receiver,
      sender: params.sender,
      gasPrice: 1_000_000_000,
      gasLimit: params.gasLimit,
      data: Buffer.from(params.data).toString('base64'),
      chainID: this.chainId,
      version: 1,
      ...(params.relayer && { relayer: params.relayer }),
    };
  }

  // ─── Admin tx: accepts already-signed tx object and forwards to chain ─────

  async forwardSignedTx(signedTxObj: object): Promise<string> {
    return this.sendRawTransaction(signedTxObj);
  }

  // ─── Relayed tx v1: bridge wraps voter's signed inner tx ─────────────────

  async wrapAndSendRelayed(innerTxObj: object): Promise<string> {
    if (!this.signer || !this._bridgeAddress) {
      throw new Error('Bridge wallet not configured — cannot send relayed tx');
    }

    const tx = Transaction.newFromPlainObject(innerTxObj as never);
    tx.relayer = Address.newFromBech32(this._bridgeAddress);

    const computer = new TransactionComputer();
    const sig = await this.signer.sign(computer.computeBytesForSigning(tx));
    tx.relayerSignature = sig;

    return this.sendRawTransaction(tx.toSendable());
  }

  // ─── Bridge-signed call (e.g. finalizeSession — anyone can call) ──────────

  async buildSignAndSend(params: {
    receiver: string;
    data: string;
    gasLimit: number;
  }): Promise<string> {
    if (!this.signer || !this._bridgeAddress) {
      throw new Error('Bridge wallet not configured');
    }

    const nonce = await this.getAccountNonce(this._bridgeAddress);

    const tx = new Transaction({
      nonce: BigInt(nonce),
      value: BigInt(0),
      receiver: Address.newFromBech32(params.receiver),
      sender: Address.newFromBech32(this._bridgeAddress),
      gasPrice: BigInt(1_000_000_000),
      gasLimit: BigInt(params.gasLimit),
      data: Buffer.from(params.data),
      chainID: this.chainId,
      version: 1,
    });

    const computer = new TransactionComputer();
    const sig = await this.signer.sign(computer.computeBytesForSigning(tx));
    tx.signature = sig;

    return this.sendRawTransaction(tx.toSendable());
  }

  private async getTransaction(txHash: string, withResults = false): Promise<Record<string, any>> {
    const suffix = withResults ? '?withResults=true' : '';
    const { data } = await axios.get(`${this.proxyUrl}/transactions/${txHash}${suffix}`);
    return (data?.data?.transaction ?? data) as Record<string, any>;
  }
}
