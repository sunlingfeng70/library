import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { Reader } from '../readers/reader.entity';
import { Staff } from '../staff/staff.entity';
import { AuthPrincipal } from './auth-principal';
import { WechatService } from './wechat.service';

export interface LoginResult {
  token: string;
}

export interface WechatLoginResult {
  bound: boolean;
  token?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Reader) private readonly readers: Repository<Reader>,
    @InjectRepository(Staff) private readonly staff: Repository<Staff>,
    private readonly wechat: WechatService,
    private readonly jwt: JwtService,
  ) {}

  async wechatLogin(code: string): Promise<WechatLoginResult> {
    const session = await this.wechat.exchangeCode(code);
    const reader = await this.readers.findOne({ where: { openid: session.openid } });
    if (!reader) {
      return { bound: false };
    }
    return { bound: true, token: await this.signReader(reader.id) };
  }

  async bindReader(code: string, cardNumber: string, password: string): Promise<LoginResult> {
    const session = await this.wechat.exchangeCode(code);
    const reader = await this.readers.findOne({ where: { cardNumber } });
    if (!reader || !(await bcrypt.compare(password, reader.passwordHash))) {
      throw new UnauthorizedException('证号或初始密码不正确');
    }
    const result = await this.readers
      .createQueryBuilder()
      .update(Reader)
      .set({ openid: session.openid })
      .where('id = :id AND openid IS NULL', { id: reader.id })
      .execute();
    if (result.affected !== 1) {
      throw new UnauthorizedException('该读者已绑定其他微信账号');
    }
    return { token: await this.signReader(reader.id) };
  }

  async staffLogin(username: string, password: string): Promise<LoginResult> {
    const staff = await this.staff.findOne({ where: { username } });
    if (!staff || !(await bcrypt.compare(password, staff.passwordHash))) {
      throw new UnauthorizedException('用户名或密码不正确');
    }
    return { token: await this.signStaff(staff.id) };
  }

  private async signReader(id: string): Promise<string> {
    const payload: AuthPrincipal = { id, kind: 'reader' };
    return this.jwt.signAsync(payload);
  }

  private async signStaff(id: string): Promise<string> {
    const payload: AuthPrincipal = { id, kind: 'staff' };
    return this.jwt.signAsync(payload);
  }
}