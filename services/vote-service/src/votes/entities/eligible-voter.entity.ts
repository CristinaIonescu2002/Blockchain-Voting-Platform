import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Session } from './session.entity';

@Entity({ schema: 'vote', name: 'eligible_voters' })
export class EligibleVoter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ length: 62 })
  wallet: string;

  @Column({ name: 'has_voted', type: 'boolean', default: false })
  hasVoted: boolean;

  @ManyToOne(() => Session, (s) => s.eligibleVoters)
  @JoinColumn({ name: 'session_id' })
  session: Session;
}
