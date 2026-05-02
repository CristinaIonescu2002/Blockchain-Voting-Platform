import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Candidate } from './candidate.entity';
import { EligibleVoter } from './eligible-voter.entity';

export type SessionStatus = 'draft' | 'open' | 'stopped' | 'finalized';

@Entity({ schema: 'vote', name: 'sessions' })
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'association_id', type: 'uuid' })
  associationId: string;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // Set by blockchain-bridge after SC call
  @Column({ name: 'sc_session_id', type: 'bigint', nullable: true })
  scSessionId: string | null;

  @Column({ length: 20, default: 'draft' })
  status: SessionStatus;

  @Column({ type: 'timestamptz', nullable: true })
  deadline: Date | null;

  @Column({ type: 'int', default: 1 })
  quorum: number;

  @Column({ name: 'max_choices', type: 'int', default: 1 })
  maxChoices: number;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => Candidate, (c) => c.session, { cascade: true })
  candidates: Candidate[];

  @OneToMany(() => EligibleVoter, (v) => v.session, { cascade: true })
  eligibleVoters: EligibleVoter[];
}
