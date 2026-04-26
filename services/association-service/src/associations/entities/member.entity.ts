import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Association } from './association.entity';

@Entity({ schema: 'association', name: 'members' })
export class Member {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'association_id', type: 'uuid' })
  associationId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'wallet_address', length: 62, nullable: true, type: 'varchar' })
  walletAddress: string | null;

  @Column({ length: 20, default: 'active' })
  status: string;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt: Date;

  @ManyToOne(() => Association, (a) => a.members)
  @JoinColumn({ name: 'association_id' })
  association: Association;
}
