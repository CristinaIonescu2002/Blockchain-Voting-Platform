import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VotesModule } from './votes/votes.module';
import { Session } from './votes/entities/session.entity';
import { Candidate } from './votes/entities/candidate.entity';
import { EligibleVoter } from './votes/entities/eligible-voter.entity';
import { AuthUser } from './votes/entities/auth-user.entity';
import { AssocMember } from './votes/entities/assoc-member.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('POSTGRES_HOST'),
        port: config.get<number>('POSTGRES_PORT'),
        username: config.get('POSTGRES_USER'),
        password: config.get('POSTGRES_PASSWORD'),
        database: config.get('POSTGRES_DB'),
        entities: [Session, Candidate, EligibleVoter, AuthUser, AssocMember],
        synchronize: false,
      }),
    }),
    VotesModule,
  ],
})
export class AppModule {}
