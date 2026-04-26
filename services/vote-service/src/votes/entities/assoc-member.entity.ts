import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

// Read-only: used to verify that requester is admin of the association.
@Entity({ schema: 'association', name: 'associations' })
export class AssocMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'admin_user_id', type: 'uuid' })
  adminUserId: string;
}
