import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AssociationsService } from './associations.service';
import { CreateAssociationDto } from './dto/create-association.dto';
import { UpdateAssociationDto } from './dto/update-association.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthUser } from './entities/auth-user.entity';

@Controller('associations')
export class AssociationsController {
  constructor(private readonly service: AssociationsService) {}

  // POST /associations
  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateAssociationDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  // GET /associations
  @Get()
  findAll() {
    return this.service.findAll();
  }

  // GET /associations/my
  @Get('my')
  @UseGuards(JwtAuthGuard)
  findMine(@CurrentUser() user: AuthUser) {
    return this.service.findMine(user.id);
  }

  // GET /associations/:id
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // PATCH /associations/:id/sc-sync — internal, no auth (called by blockchain-bridge)
  // Only allows writing scAssocId (on-chain registration ID).
  @Patch(':id/sc-sync')
  @HttpCode(HttpStatus.OK)
  syncScId(
    @Param('id') id: string,
    @Body('scAssocId') scAssocId: number,
  ) {
    return this.service.syncScId(id, scAssocId);
  }

  // PATCH /associations/:id
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAssociationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.id);
  }

  // POST /associations/:id/members
  @Post(':id/members')
  @UseGuards(JwtAuthGuard)
  addMember(
    @Param('id') assocId: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addMember(assocId, dto, user.id);
  }

  // DELETE /associations/:id/members/:userId
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  removeMember(
    @Param('id') assocId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.removeMember(assocId, userId, user.id);
  }

  // GET /associations/:id/members
  @Get(':id/members')
  @UseGuards(JwtAuthGuard)
  getMembers(@Param('id') assocId: string) {
    return this.service.getMembers(assocId);
  }
}
