import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Association } from './entities/association.entity';
import { Member } from './entities/member.entity';
import { AuthUser } from './entities/auth-user.entity';
import { CreateAssociationDto } from './dto/create-association.dto';
import { UpdateAssociationDto } from './dto/update-association.dto';
import { AddMemberDto } from './dto/add-member.dto';

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

  async findMine(userId: string): Promise<Association[]> {
    return this.associations.find({
      where: { adminUserId: userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Association> {
    const assoc = await this.associations.findOne({ where: { id } });
    if (!assoc) throw new NotFoundException('Association not found');
    return assoc;
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

    const existing = await this.members.findOne({
      where: { associationId: assocId, userId: dto.userId },
    });
    if (existing) {
      if (existing.status === 'active') throw new ConflictException('Already a member');
      // Re-activate removed member
      existing.status = 'active';
      if (dto.walletAddress) existing.walletAddress = dto.walletAddress;
      return this.members.save(existing);
    }

    // Resolve wallet: from DTO, or from auth.users
    let wallet = dto.walletAddress ?? null;
    if (!wallet) {
      const user = await this.authUsers.findOne({ where: { id: dto.userId } });
      wallet = user?.walletAddress ?? null;
    }

    return this.members.save(
      this.members.create({
        associationId: assocId,
        userId: dto.userId,
        walletAddress: wallet,
        status: 'active',
      }),
    );
  }

  async removeMember(assocId: string, userId: string, requesterId: string): Promise<void> {
    const assoc = await this.findOne(assocId);
    this.requireAdmin(assoc, requesterId);

    const member = await this.members.findOne({
      where: { associationId: assocId, userId, status: 'active' },
    });
    if (!member) throw new NotFoundException('Member not found');

    member.status = 'removed';
    await this.members.save(member);
  }

  async getMembers(assocId: string): Promise<Member[]> {
    await this.findOne(assocId); // ensure exists
    return this.members.find({
      where: { associationId: assocId, status: 'active' },
      order: { joinedAt: 'ASC' },
    });
  }

  private requireAdmin(assoc: Association, userId: string): void {
    if (assoc.adminUserId !== userId) {
      throw new ForbiddenException('Only the association admin can perform this action');
    }
  }
}
