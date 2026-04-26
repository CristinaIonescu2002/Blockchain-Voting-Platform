import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BridgeController } from './bridge.controller';
import { BridgeService } from './bridge.service';
import { ChainService } from './chain/chain.service';

@Module({
  imports: [ConfigModule],
  controllers: [BridgeController],
  providers: [BridgeService, ChainService],
})
export class BridgeModule {}
