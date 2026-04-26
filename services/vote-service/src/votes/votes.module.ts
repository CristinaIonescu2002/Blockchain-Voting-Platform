import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VotesController } from './votes.controller';
import { VotesService } from './votes.service';
import { Session } from './entities/session.entity';
import { Candidate } from './entities/candidate.entity';
import { EligibleVoter } from './entities/eligible-voter.entity';
import { AuthUser } from './entities/auth-user.entity';
import { AssocMember } from './entities/assoc-member.entity';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    TypeOrmModule.forFeature([Session, Candidate, EligibleVoter, AuthUser, AssocMember]),
  ],
  controllers: [VotesController],
  providers: [VotesService, JwtStrategy],
})
export class VotesModule {}
