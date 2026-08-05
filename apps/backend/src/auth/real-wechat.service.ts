import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WechatService, WechatSession } from './wechat.service';

@Injectable()
export class RealWechatService implements WechatService {
  constructor(private readonly config: ConfigService) {}

  async exchangeCode(code: string): Promise<WechatSession> {
    const appid = this.config.get<string>('WECHAT_APP_ID');
    const secret = this.config.get<string>('WECHAT_APP_SECRET');
    if (!appid || !secret) {
      throw new Error('WECHAT_APP_ID / WECHAT_APP_SECRET 未配置');
    }
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`微信 code2session HTTP ${response.status}`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    if (typeof payload.errcode === 'number' && payload.errcode !== 0) {
      throw new Error(`微信 code2session 失败: ${String(payload.errmsg)}`);
    }
    if (typeof payload.openid !== 'string' || payload.openid.length === 0) {
      throw new Error('微信 code2session 未返回 openid');
    }
    const unionid = typeof payload.unionid === 'string' ? payload.unionid : null;
    return new WechatSession(payload.openid, unionid);
  }
}