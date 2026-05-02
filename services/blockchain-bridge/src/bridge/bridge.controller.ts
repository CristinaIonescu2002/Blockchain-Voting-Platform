import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { BridgeService } from './bridge.service';
import { BuildVoteTxDto } from './dto/build-vote-tx.dto';
import { BuildCreateSessionTxDto } from './dto/build-create-session-tx.dto';
import { SubmitVoteTxDto } from './dto/submit-vote-tx.dto';
import { SubmitSignedTxDto } from './dto/submit-signed-tx.dto';

@Controller('bridge')
export class BridgeController {
  constructor(private readonly service: BridgeService) {}

  // ─── Unsigned tx builders ─────────────────────────────────────────────────

  // GET /bridge/tx/register-association?name=...&senderAddress=...
  @Get('tx/register-association')
  buildRegisterAssociation(
    @Query('name') name: string,
    @Query('senderAddress') senderAddress: string,
  ) {
    if (!name || !senderAddress) {
      throw new BadRequestException('name and senderAddress are required');
    }
    return this.service.buildRegisterAssociationTx(name, senderAddress);
  }

  // GET /bridge/tx/register-member?scAssocId=...&memberWallet=...&senderAddress=...
  @Get('tx/register-member')
  buildRegisterMember(
    @Query('scAssocId') scAssocId: string,
    @Query('memberWallet') memberWallet: string,
    @Query('senderAddress') senderAddress: string,
  ) {
    if (!scAssocId || !memberWallet || !senderAddress) {
      throw new BadRequestException('scAssocId, memberWallet and senderAddress are required');
    }
    return this.service.buildRegisterMemberTx(BigInt(scAssocId), memberWallet, senderAddress);
  }

  // POST /bridge/tx/create-session  — admin requests unsigned tx to send to chain
  @Post('tx/create-session')
  buildCreateSession(@Body() dto: BuildCreateSessionTxDto) {
    return this.service.buildCreateSessionTx({
      scAssocId: BigInt(dto.scAssocId),
      title: dto.title,
      deadlineTimestamp: BigInt(dto.deadlineTimestamp),
      quorum: BigInt(dto.quorum),
      maxChoices: BigInt(dto.maxChoices),
      candidateWallets: dto.candidateWallets,
      eligibleVoterWallets: dto.eligibleVoterWallets,
      senderBech32: dto.senderAddress,
    });
  }

  // GET /bridge/tx/stop-session?scAssocId=...&scSessionId=...&senderAddress=...
  @Get('tx/stop-session')
  buildStopSession(
    @Query('scAssocId') scAssocId: string,
    @Query('scSessionId') scSessionId: string,
    @Query('senderAddress') senderAddress: string,
  ) {
    if (!scAssocId || !scSessionId || !senderAddress) {
      throw new BadRequestException('scAssocId, scSessionId and senderAddress are required');
    }
    return this.service.buildStopSessionTx(BigInt(scAssocId), BigInt(scSessionId), senderAddress);
  }

  // GET /bridge/tx/vote?scAssocId=...&scSessionId=...&candidateWallet=...&voterWallet=...
  @Get('tx/vote')
  buildVoteTx(@Query() dto: BuildVoteTxDto) {
    return this.service.buildVoteTx(dto);
  }

  // ─── Submit ───────────────────────────────────────────────────────────────

  // POST /bridge/tx/submit  — admin sends already-signed tx here
  @Post('tx/submit')
  submitAdminTx(@Body() dto: SubmitSignedTxDto) {
    return this.service.submitAdminTx(dto);
  }

  // POST /bridge/tx/vote/submit  — voter sends signed inner tx, bridge relays
  @Post('tx/vote/submit')
  submitVote(@Body() dto: SubmitVoteTxDto) {
    return this.service.submitVote(dto);
  }

  // POST /bridge/finalize/:sessionId?scAssocId=...&scSessionId=...
  @Post('finalize/:sessionId')
  @HttpCode(HttpStatus.OK)
  finalizeSession(
    @Param('sessionId') sessionId: string,
    @Query('scAssocId') scAssocId: string,
    @Query('scSessionId') scSessionId: string,
  ) {
    if (!scAssocId || !scSessionId) {
      throw new BadRequestException('scAssocId and scSessionId are required');
    }
    return this.service.finalizeSession(BigInt(scAssocId), BigInt(scSessionId), sessionId);
  }
}
