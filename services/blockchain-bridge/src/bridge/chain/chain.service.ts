import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Address, Transaction, TransactionComputer, UserSigner } from '@multiversx/sdk-core';
import axios from 'axios';
import * as fs from 'fs';

@Injectable()
export class ChainService implements OnModuleInit {
  private readonly logger = new Logger(ChainService.name);

  private signer: UserSigner | null = null;
  private _bridgeAddress: string | null = null;
  private proxyUrl: string;
  private chainId: string;
  private _contractAddress: string;

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

  /** Call a view function on the SC and return raw base64 returnData. */
  async queryView(funcName: string, hexArgs: string[] = []): Promise<string[]> {
    const { data } = await axios.post(`${this.proxyUrl}/vm-values/query`, {
      scAddress: this._contractAddress,
      funcName,
      args: hexArgs,
    });
    return data?.data?.returnData ?? data?.returnData ?? [];
  }

  /** Decode a base64 u64 returnData[0] into a JS number. */
  decodeU64ReturnValue(base64: string | undefined): number {
    if (!base64) return 0;
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0) return 0;
    return Number(BigInt('0x' + bytes.toString('hex')));
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

  // ─── ABI encoding helpers ─────────────────────────────────────────────────

  /**
   * Encode a u32 count as a 4-byte big-endian hex string.
   * Used as prefix for MultiValueEncoded args when the endpoint
   * uses #[allow_multiple_var_args] with multiple variadic parameters.
   */
  encodeCount(n: number): string {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(n, 0);
    return buf.toString('hex');
  }

  encodeU64(n: bigint): string {
    if (n === 0n) return '';
    const hex = n.toString(16);
    return hex.length % 2 === 0 ? hex : '0' + hex;
  }

  encodeAddress(bech32: string): string {
    return Address.newFromBech32(bech32).toHex();
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

    const innerJson = JSON.stringify(innerTxObj);
    const innerHex = Buffer.from(innerJson).toString('hex');
    const data = `relayedTx@${innerHex}`;

    const inner = innerTxObj as Record<string, unknown>;
    const innerSenderBech32 = inner.sender as string;
    const innerGasLimit = Number(inner.gasLimit ?? 10_000_000);

    const bridgeNonce = await this.getAccountNonce(this._bridgeAddress);
    // Relayed tx gas = inner gas + base cost + per-byte cost
    const relayedGasLimit = innerGasLimit + 50_000 + 1_500 * data.length;

    const tx = new Transaction({
      nonce: BigInt(bridgeNonce),
      value: BigInt(0),
      receiver: Address.newFromBech32(innerSenderBech32),
      sender: Address.newFromBech32(this._bridgeAddress),
      gasPrice: BigInt(1_000_000_000),
      gasLimit: BigInt(relayedGasLimit),
      data: Buffer.from(data),
      chainID: this.chainId,
      version: 1,
    });

    const computer = new TransactionComputer();
    const sig = await this.signer.sign(computer.computeBytesForSigning(tx));
    tx.signature = sig;

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
}
