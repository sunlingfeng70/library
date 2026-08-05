import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reader } from '../readers/reader.entity';
import { Staff } from '../staff/staff.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RolesGuard } from './guards/roles.guard';
import { RealWechatService } from './real-wechat.service';
import { WechatService } from './wechat.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reader, Staff]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET 未配置');
        }
        return { secret, signOptions: { expiresIn: '7d' } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
    { provide: WechatService, useClass: RealWechatService },
  ],
  exports: [JwtModule, WechatService, JwtAuthGuard, RolesGuard, PermissionsGuard],
})
export class AuthModule {}