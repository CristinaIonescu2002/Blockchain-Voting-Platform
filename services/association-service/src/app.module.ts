import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssociationsModule } from './associations/associations.module';
import { Association } from './associations/entities/association.entity';
import { Member } from './associations/entities/member.entity';
import { AuthUser } from './associations/entities/auth-user.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('POSTGRES_HOST'),
        port: config.get<number>('POSTGRES_PORT'),
        username: config.get('POSTGRES_USER'),
        password: config.get('POSTGRES_PASSWORD'),
        database: config.get('POSTGRES_DB'),
        entities: [Association, Member, AuthUser],
        synchronize: false,
      }),
    }),
    AssociationsModule,
  ],
})
export class AppModule {}
