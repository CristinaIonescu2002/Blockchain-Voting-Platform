import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BridgeModule } from './bridge/bridge.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BridgeModule,
  ],
})
export class AppModule {}
