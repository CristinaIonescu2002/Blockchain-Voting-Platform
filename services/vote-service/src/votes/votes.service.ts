import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Session } from './entities/session.entity';
import { Candidate } from './entities/candidate.entity';
import { EligibleVoter } from './entities/eligible-voter.entity';
import { AssocMember } from './entities/assoc-member.entity';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { RecordVoteDto } from './dto/record-vote.dto';

@Injectable()
export class VotesService {
  constructor(
    @InjectRepository(Session) private sessions: Repository<Session>,
    @InjectRepository(Candidate) private candidates: Repository<Candidate>,
    @InjectRepository(EligibleVoter) private voters: Repository<EligibleVoter>,
    @InjectRepository(AssocMember) private associations: Repository<AssocMember>,
    private dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource.query(`
      ALTER TABLE vote.sessions
      ADD COLUMN IF NOT EXISTS max_choices INT DEFAULT 1
    `);
  }

  async createSession(dto: CreateSessionDto, userId: string): Promise<Session> {
    await this.requireAssocAdmin(dto.associationId, userId);

    const candidates = dto.candidates.map((candidate) => ({
      ...candidate,
      wallet: candidate.wallet.trim(),
    }));
    const eligibleVoters = dto.eligibleVoters.map((voter) => ({
      ...voter,
      wallet: voter.wallet.trim(),
    }));

    if (candidates.length < 2) {
      throw new BadRequestException('Select at least 2 candidates');
    }
    if (eligibleVoters.length === 0) {
      throw new BadRequestException('Select at least one eligible voter');
    }
    if (dto.maxChoices > candidates.length) {
      throw new BadRequestException(
        'The max number of choices cannot exceed the number of candidates',
      );
    }

    this.assertUniqueWallets(
      'Candidate',
      candidates.map((candidate) => candidate.wallet),
    );
    this.assertUniqueWallets(
      'Eligible voter',
      eligibleVoters.map((voter) => voter.wallet),
    );

    const sessionId = await this.dataSource.transaction(async (manager) => {
      const session = await manager.save(
        Session,
        manager.create(Session, {
          associationId: dto.associationId,
          title: dto.title,
          description: dto.description ?? null,
          deadline: new Date(dto.deadline),
          quorum: dto.quorum,
          maxChoices: dto.maxChoices,
          status: 'draft',
          createdBy: userId,
        }),
      );

      await manager.save(
        Candidate,
        candidates.map((candidate) =>
          manager.create(Candidate, {
            sessionId: session.id,
            name: candidate.name,
            wallet: candidate.wallet,
            userId: candidate.userId ?? null,
          }),
        ),
      );

      await manager.save(
        EligibleVoter,
        eligibleVoters.map((voter) =>
          manager.create(EligibleVoter, {
            sessionId: session.id,
            wallet: voter.wallet,
            userId: voter.userId ?? null,
          }),
        ),
      );

      return session.id;
    });

    return this.findOne(sessionId);
  }

  async findByAssociation(associationId: string): Promise<Session[]> {
    return this.sessions.find({
      where: { associationId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Session> {
    const session = await this.sessions.findOne({
      where: { id },
      relations: ['candidates', 'eligibleVoters'],
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  /** Internal: set the on-chain session ID and status — called by blockchain-bridge, no user auth. */
  async syncScId(id: string, scSessionId: number, status?: string): Promise<Session> {
    const session = await this.findOne(id);
    if (scSessionId !== undefined) session.scSessionId = String(scSessionId);
    if (status) session.status = status as import('./entities/session.entity').SessionStatus;
    await this.sessions.save(session);
    return this.findOne(id);
  }

  async updateSession(id: string, dto: UpdateSessionDto, userId: string): Promise<Session> {
    const session = await this.findOne(id);
    await this.requireAssocAdmin(session.associationId, userId);

    if (dto.status !== undefined) session.status = dto.status;
    if (dto.scSessionId !== undefined) session.scSessionId = dto.scSessionId;

    await this.sessions.save(session);
    return this.findOne(id);
  }

  async getResults(id: string) {
    const session = await this.findOne(id);
    const totalVoters = await this.voters.count({ where: { sessionId: id } });
    const votedCount = await this.voters.count({ where: { sessionId: id, hasVoted: true } });

    const candidatesWithVotes = await this.candidates.find({
      where: { sessionId: id },
      order: { voteCount: 'DESC' },
    });

    // `finalized` is set only after blockchain-bridge confirms on-chain finalizeSession —
    // winner must match smart-contract outcome, not app-local shortcuts.
    const winner =
      session.status === 'finalized' && candidatesWithVotes.length > 0
        ? candidatesWithVotes[0]
        : null;

    return {
      session: {
        id: session.id,
        title: session.title,
        status: session.status,
        scSessionId: session.scSessionId,
        associationId: session.associationId,
        deadline: session.deadline,
        maxChoices: session.maxChoices,
      },
      totalEligible: totalVoters,
      totalVoted: votedCount,
      quorumReached: votedCount >= session.quorum,
      candidates: candidatesWithVotes,
      winner,
    };
  }

  // Called by blockchain-bridge after castVote tx confirmed on-chain.
  async recordVote(sessionId: string, dto: RecordVoteDto): Promise<void> {
    const wallets = dto.candidateWallets?.length
      ? dto.candidateWallets
      : dto.candidateWallet
        ? [dto.candidateWallet]
        : [];

    await this.dataSource.transaction(async (manager) => {
      const voter = await manager.findOne(EligibleVoter, {
        where: { sessionId, wallet: dto.voterWallet },
        lock: { mode: 'pessimistic_write' },
      });
      if (!voter || voter.hasVoted) return;

      voter.hasVoted = true;
      await manager.save(voter);

      for (const wallet of new Set(wallets)) {
        await manager
          .createQueryBuilder()
          .update(Candidate)
          .set({ voteCount: () => '"vote_count" + 1' })
          .where('session_id = :sessionId AND wallet = :wallet', {
            sessionId,
            wallet,
          })
          .execute();
      }
    });
  }

  async deleteUnpublishedSession(id: string, userId: string): Promise<void> {
    const session = await this.findOne(id);
    await this.requireAssocAdmin(session.associationId, userId);

    if (session.scSessionId) {
      throw new BadRequestException('Only sessions that are not published on-chain can be deleted');
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Candidate, { sessionId: id });
      await manager.delete(EligibleVoter, { sessionId: id });
      await manager.delete(Session, { id });
    });
  }

  private async requireAssocAdmin(associationId: string, userId: string): Promise<void> {
    const assoc = await this.associations.findOne({ where: { id: associationId } });
    if (!assoc) throw new NotFoundException('Association not found');
    if (assoc.adminUserId !== userId) {
      throw new ForbiddenException('Only the association admin can manage sessions');
    }
  }

  private assertUniqueWallets(label: string, wallets: string[]): void {
    const seen = new Set<string>();
    for (const wallet of wallets) {
      const key = wallet.toLowerCase();
      if (!key) {
        throw new BadRequestException(`${label} wallet cannot be empty`);
      }
      if (seen.has(key)) {
        throw new BadRequestException(`${label} wallet is duplicated: ${wallet}`);
      }
      seen.add(key);
    }
  }
}
