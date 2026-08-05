import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { BindReaderDto, StaffLoginDto, WechatLoginDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('wechat/login')
  @HttpCode(HttpStatus.OK)
  wechatLogin(@Body() body: WechatLoginDto) {
    return this.auth.wechatLogin(body.code);
  }

  @Post('bind')
  @HttpCode(HttpStatus.OK)
  bind(@Body() body: BindReaderDto) {
    return this.auth.bindReader(body.code, body.cardNumber, body.password);
  }

  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  staffLogin(@Body() body: StaffLoginDto) {
    return this.auth.staffLogin(body.username, body.password);
  }
}