import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Association } from './entities/association.entity';
import { Member } from './entities/member.entity';
import { AuthUser } from './entities/auth-user.entity';
import { CreateAssociationDto } from './dto/create-association.dto';
import { UpdateAssociationDto } from './dto/update-association.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { SetPaymasterDto } from './dto/set-paymaster.dto';

@Injectable()
export class AssociationsService {
  constructor(
    @InjectRepository(Association) private associations: Repository<Association>,
    @InjectRepository(Member) private members: Repository<Member>,
    @InjectRepository(AuthUser) private authUsers: Repository<AuthUser>,
  ) {}

  async create(dto: CreateAssociationDto, userId: string): Promise<Association> {
    const user = await this.authUsers.findOne({ where: { id: userId } });
    const assoc = this.associations.create({
      name: dto.name,
      description: dto.description ?? null,
      adminUserId: userId,
      adminWallet: user?.walletAddress ?? null,
    });
    return this.associations.save(assoc);
  }

  findAll(): Promise<Association[]> {
    return this.associations.find({ order: { createdAt: 'DESC' } });
  }

  /** Returns all associations the user can access: ones they admin + ones they're a member of. */
  async findMine(userId: string): Promise<(Association & { userMembershipStatus?: string })[]> {
    // 1. Associations where user is the admin
    const adminAssocs = await this.associations.find({
      where: { adminUserId: userId },
      order: { createdAt: 'DESC' },
    });
    const adminIds = new Set(adminAssocs.map((a) => a.id));

    // 2. Associations where user is an active member (but not the admin — avoid duplicates)
    const memberRecords = await this.members.find({
      where: { userId, status: In(['active', 'pending']) },
    });
    const memberAssocIds = memberRecords
      .map((m) => m.associationId)
      .filter((id) => !adminIds.has(id));

    if (memberAssocIds.length === 0) return adminAssocs;

    const memberAssocs = await this.associations.find({
      where: { id: In(memberAssocIds) },
      order: { createdAt: 'DESC' },
    });
    const statusByAssocId = new Map(
      memberRecords.map((member) => [member.associationId, member.status]),
    );
    const memberAssocsWithStatus = memberAssocs.map((assoc) => ({
      ...assoc,
      userMembershipStatus: statusByAssocId.get(assoc.id),
    }));

    // Sort combined list by createdAt descending
    return [...adminAssocs, ...memberAssocsWithStatus].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async findOne(id: string): Promise<Association> {
    const assoc = await this.associations.findOne({ where: { id } });
    if (!assoc) throw new NotFoundException('Association not found');
    return assoc;
  }

  async setPaymaster(id: string, dto: SetPaymasterDto, userId: string): Promise<Association> {
    const assoc = await this.findOne(id);
    this.requireAdmin(assoc, userId);

    assoc.paymasterWallet = dto.walletAddress;
    assoc.paymasterPem = dto.pemContent;
    await this.associations.save(assoc);
    return this.findOne(id);
  }

  async getPaymaster(id: string): Promise<{ walletAddress: string; pemContent: string }> {
    const assoc = await this.associations
      .createQueryBuilder('assoc')
      .addSelect('assoc.paymasterPem')
      .where('assoc.id = :id', { id })
      .getOne();
    if (!assoc) throw new NotFoundException('Association not found');
    if (!assoc.paymasterWallet || !assoc.paymasterPem) {
      throw new NotFoundException('Association paymaster not configured');
    }

    return {
      walletAddress: assoc.paymasterWallet,
      pemContent: assoc.paymasterPem,
    };
  }

  /** Internal: set the on-chain assoc ID — called by blockchain-bridge, no user auth needed. */
  async syncScId(id: string, scAssocId: number): Promise<Association> {
    const assoc = await this.findOne(id);
    assoc.scAssocId = String(scAssocId);
    return this.associations.save(assoc);
  }

  async update(id: string, dto: UpdateAssociationDto, userId: string): Promise<Association> {
    const assoc = await this.findOne(id);
    this.requireAdmin(assoc, userId);

    Object.assign(assoc, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.scAssocId !== undefined && { scAssocId: dto.scAssocId }),
    });
    return this.associations.save(assoc);
  }

  async addMember(assocId: string, dto: AddMemberDto, requesterId: string): Promise<Member> {
    const assoc = await this.findOne(assocId);
    this.requireAdmin(assoc, requesterId);

    // Resolve userId: accept either userId directly or userEmail → look up user
    let resolvedUserId = dto.userId;
    if (!resolvedUserId && dto.userEmail) {
      const user = await this.authUsers.findOne({ where: { email: dto.userEmail } });
      if (!user) throw new NotFoundException(`User with email "${dto.userEmail}" not found`);
      resolvedUserId = user.id;
    }
    if (!resolvedUserId) {
      throw new BadRequestException('Either userId or userEmail must be provided');
    }

    const existing = await this.members.findOne({
      where: { associationId: assocId, userId: resolvedUserId },
    });
    if (existing) {
      if (existing.status === 'active') throw new ConflictException('Already a member');
      existing.status = 'pending';
      existing.walletAddress = null;
      return this.members.save(existing);
    }

    return this.members.save(
      this.members.create({
        associationId: assocId,
        userId: resolvedUserId,
        walletAddress: null,
        status: 'pending',
      }),
    );
  }

  async acceptMemberInvite(assocId: string, userId: string): Promise<Member> {
    await this.findOne(assocId);

    const user = await this.authUsers.findOne({ where: { id: userId } });
    if (!user?.walletAddress) {
      throw new BadRequestException('Link a wallet to your account before accepting the invite');
    }

    const member = await this.members.findOne({
      where: { associationId: assocId, userId, status: 'pending' },
    });
    if (!member) throw new NotFoundException('Pending invite not found');

    member.status = 'active';
    member.walletAddress = user.walletAddress;
    return this.members.save(member);
  }

  async removeMember(assocId: string, userId: string, requesterId: string): Promise<void> {
    const assoc = await this.findOne(assocId);
    this.requireAdmin(assoc, requesterId);

    const member = await this.members.findOne({
      where: { associationId: assocId, userId, status: In(['active', 'pending']) },
    });
    if (!member) throw new NotFoundException('Member not found');

    member.status = 'removed';
    await this.members.save(member);
  }

  async getMembers(
    assocId: string,
    requesterId: string,
  ): Promise<(Member & { user?: { email: string } })[]> {
    const assoc = await this.findOne(assocId);
    const requesterMember = await this.members.findOne({
      where: { associationId: assocId, userId: requesterId, status: In(['active', 'pending']) },
    });
    if (assoc.adminUserId !== requesterId && !requesterMember) {
      throw new ForbiddenException('You do not have access to this association');
    }

    const members = await this.members.find({
      where: { associationId: assocId, status: In(['active', 'pending']) },
      order: { joinedAt: 'ASC' },
    });

    // Enrich each member with user email from auth.users
    const results = await Promise.all(
      members.map(async (m) => {
        const user = await this.authUsers.findOne({ where: { id: m.userId } });
        return { ...m, user: user ? { email: user.email } : undefined };
      }),
    );
    return results;
  }

  private requireAdmin(assoc: Association, userId: string): void {
    if (assoc.adminUserId !== userId) {
      throw new ForbiddenException('Only the association admin can perform this action');
    }
  }
}
