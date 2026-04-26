import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Session } from './session.entity';

@Entity({ schema: 'vote', name: 'candidates' })
export class Candidate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 62 })
  wallet: string;

  @Column({ name: 'vote_count', type: 'int', default: 0 })
  voteCount: number;

  @ManyToOne(() => Session, (s) => s.candidates)
  @JoinColumn({ name: 'session_id' })
  session: Session;
}
