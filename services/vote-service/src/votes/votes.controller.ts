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
  Query,
  UseGuards,
} from '@nestjs/common';
import { VotesService } from './votes.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { RecordVoteDto } from './dto/record-vote.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthUser } from './entities/auth-user.entity';

@Controller('votes')
export class VotesController {
  constructor(private readonly service: VotesService) {}

  // POST /votes/sessions
  @Post('sessions')
  @UseGuards(JwtAuthGuard)
  createSession(@Body() dto: CreateSessionDto, @CurrentUser() user: AuthUser) {
    return this.service.createSession(dto, user.id);
  }

  // GET /votes/sessions?associationId=...
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  findSessions(@Query('associationId') associationId: string) {
    return this.service.findByAssociation(associationId);
  }

  // GET /votes/sessions/:id
  @Get('sessions/:id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // PATCH /votes/sessions/:id/sc-sync — internal, no auth (called by blockchain-bridge)
  // Allows writing scSessionId and status.
  @Patch('sessions/:id/sc-sync')
  @HttpCode(HttpStatus.OK)
  syncScId(
    @Param('id') id: string,
    @Body('scSessionId') scSessionId: number,
    @Body('status') status: string,
  ) {
    return this.service.syncScId(id, scSessionId, status);
  }

  // PATCH /votes/sessions/:id — used by bridge to set scSessionId / update status
  @Patch('sessions/:id')
  @UseGuards(JwtAuthGuard)
  updateSession(
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateSession(id, dto, user.id);
  }

  // DELETE /votes/sessions/:id — admin can remove only sessions not published on-chain
  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.deleteUnpublishedSession(id, user.id);
  }

  // GET /votes/sessions/:id/results
  @Get('sessions/:id/results')
  @UseGuards(JwtAuthGuard)
  getResults(@Param('id') id: string) {
    return this.service.getResults(id);
  }

  // POST /votes/sessions/:id/record-vote — internal, called by blockchain-bridge
  @Post('sessions/:id/record-vote')
  @HttpCode(HttpStatus.NO_CONTENT)
  recordVote(@Param('id') sessionId: string, @Body() dto: RecordVoteDto) {
    return this.service.recordVote(sessionId, dto);
  }
}
