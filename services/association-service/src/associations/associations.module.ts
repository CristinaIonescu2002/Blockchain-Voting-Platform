import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssociationsController } from './associations.controller';
import { AssociationsService } from './associations.service';
import { Association } from './entities/association.entity';
import { Member } from './entities/member.entity';
import { AuthUser } from './entities/auth-user.entity';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    TypeOrmModule.forFeature([Association, Member, AuthUser]),
  ],
  controllers: [AssociationsController],
  providers: [AssociationsService, JwtStrategy],
})
export class AssociationsModule {}
