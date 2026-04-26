import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Member } from './member.entity';

@Entity({ schema: 'association', name: 'associations' })
export class Association {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'admin_user_id', type: 'uuid' })
  adminUserId: string;

  @Column({ name: 'admin_wallet', length: 62, nullable: true, type: 'varchar' })
  adminWallet: string | null;

  // Set by blockchain-bridge after on-chain registration
  @Column({ name: 'sc_assoc_id', length: 64, nullable: true, type: 'varchar' })
  scAssocId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => Member, (m) => m.association)
  members: Member[];
}
