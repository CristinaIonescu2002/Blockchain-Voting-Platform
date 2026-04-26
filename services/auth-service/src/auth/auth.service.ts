import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { User } from './entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(RefreshToken) private refreshTokens: Repository<RefreshToken>,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.users.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.users.save(
      this.users.create({ email: dto.email, passwordHash }),
    );
    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOne({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; type: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') throw new UnauthorizedException('Invalid token type');

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.refreshTokens.findOne({
      where: { userId: payload.sub, tokenHash },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired or revoked');
    }

    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException();

    // Rotate: invalidate old token, issue new pair
    await this.refreshTokens.delete({ id: stored.id });
    return this.issueTokens(user);
  }

  async logout(userId: string): Promise<void> {
    await this.refreshTokens.delete({ userId });
  }

  async linkWallet(userId: string, walletAddress: string) {
    await this.users.update(userId, { walletAddress });
    return this.safeUser(await this.users.findOneOrFail({ where: { id: userId } }));
  }

  async me(userId: string) {
    return this.safeUser(await this.users.findOneOrFail({ where: { id: userId } }));
  }

  // ─── Private helpers ────────────────────────────────────────────────

  private async issueTokens(user: User) {
    const accessToken = this.jwt.sign(
      { sub: user.id, email: user.email },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { expiresIn: (this.config.get('JWT_EXPIRES_IN') ?? '15m') as any },
    );

    const refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    const refreshToken = this.jwt.sign(
      { sub: user.id, type: 'refresh' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { expiresIn: refreshExpiresIn as any },
    );

    const expiresAt = new Date(Date.now() + this.parseDuration(refreshExpiresIn));
    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
      }),
    );

    return { accessToken, refreshToken, user: this.safeUser(user) };
  }

  private safeUser(user: User) {
    return { id: user.id, email: user.email, walletAddress: user.walletAddress };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const multipliers: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return parseInt(match[1]) * multipliers[match[2]];
  }
}
