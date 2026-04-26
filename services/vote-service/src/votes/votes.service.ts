import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  ) {}

  async createSession(dto: CreateSessionDto, userId: string): Promise<Session> {
    await this.requireAssocAdmin(dto.associationId, userId);

    const session = await this.sessions.save(
      this.sessions.create({
        associationId: dto.associationId,
        title: dto.title,
        description: dto.description ?? null,
        deadline: new Date(dto.deadline),
        quorum: dto.quorum,
        status: 'draft',
        createdBy: userId,
      }),
    );

    await this.candidates.save(
      dto.candidates.map((c) =>
        this.candidates.create({
          sessionId: session.id,
          name: c.name,
          wallet: c.wallet,
          userId: c.userId ?? null,
        }),
      ),
    );

    await this.voters.save(
      dto.eligibleVoters.map((v) =>
        this.voters.create({
          sessionId: session.id,
          wallet: v.wallet,
          userId: v.userId ?? null,
        }),
      ),
    );

    return this.findOne(session.id);
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

    const winner =
      session.status === 'finalized' && candidatesWithVotes.length > 0
        ? candidatesWithVotes[0]
        : null;

    return {
      session: { id: session.id, title: session.title, status: session.status },
      totalEligible: totalVoters,
      totalVoted: votedCount,
      quorumReached: votedCount >= session.quorum,
      candidates: candidatesWithVotes,
      winner,
    };
  }

  // Called by blockchain-bridge after castVote tx confirmed on-chain.
  async recordVote(sessionId: string, dto: RecordVoteDto): Promise<void> {
    const voter = await this.voters.findOne({
      where: { sessionId, wallet: dto.voterWallet },
    });
    if (voter && !voter.hasVoted) {
      voter.hasVoted = true;
      await this.voters.save(voter);
    }

    await this.candidates
      .createQueryBuilder()
      .update()
      .set({ voteCount: () => '"vote_count" + 1' })
      .where('session_id = :sessionId AND wallet = :wallet', {
        sessionId,
        wallet: dto.candidateWallet,
      })
      .execute();
  }

  private async requireAssocAdmin(associationId: string, userId: string): Promise<void> {
    const assoc = await this.associations.findOne({ where: { id: associationId } });
    if (!assoc) throw new NotFoundException('Association not found');
    if (assoc.adminUserId !== userId) {
      throw new ForbiddenException('Only the association admin can manage sessions');
    }
  }
}
