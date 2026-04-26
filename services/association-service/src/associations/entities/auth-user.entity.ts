import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

// Read-only view over auth.users — association-service reads wallet address from here.
@Entity({ schema: 'auth', name: 'users' })
export class AuthUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'wallet_address', length: 62, nullable: true, type: 'varchar' })
  walletAddress: string | null;
}
