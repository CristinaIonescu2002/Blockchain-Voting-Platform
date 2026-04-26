import {
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
import { SubmitVoteTxDto } from './dto/submit-vote-tx.dto';
import { SubmitSignedTxDto } from './dto/submit-signed-tx.dto';

@Controller('bridge')
export class BridgeController {
  constructor(private readonly service: BridgeService) {}

  // ─── Unsigned tx builders ─────────────────────────────────────────────────

  // GET /bridge/tx/register-association?name=...&sender=...
  @Get('tx/register-association')
  buildRegisterAssociation(
    @Query('name') name: string,
    @Query('sender') sender: string,
  ) {
    return this.service.buildRegisterAssociationTx(name, sender);
  }

  // GET /bridge/tx/register-member?scAssocId=...&memberWallet=...&sender=...
  @Get('tx/register-member')
  buildRegisterMember(
    @Query('scAssocId') scAssocId: string,
    @Query('memberWallet') memberWallet: string,
    @Query('sender') sender: string,
  ) {
    return this.service.buildRegisterMemberTx(BigInt(scAssocId), memberWallet, sender);
  }

  // GET /bridge/tx/stop-session?scAssocId=...&scSessionId=...&sender=...
  @Get('tx/stop-session')
  buildStopSession(
    @Query('scAssocId') scAssocId: string,
    @Query('scSessionId') scSessionId: string,
    @Query('sender') sender: string,
  ) {
    return this.service.buildStopSessionTx(BigInt(scAssocId), BigInt(scSessionId), sender);
  }

  // GET /bridge/tx/vote  — returns unsigned inner tx for voter to sign
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
    return this.service.finalizeSession(BigInt(scAssocId), BigInt(scSessionId), sessionId);
  }
}
