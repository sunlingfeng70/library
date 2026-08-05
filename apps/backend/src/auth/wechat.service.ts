export class WechatSession {
  constructor(
    public readonly openid: string,
    public readonly unionid: string | null = null,
  ) {}
}

/**
 * 用微信登录 code 换取 openid 的服务接口。
 */
export abstract class WechatService {
  abstract exchangeCode(code: string): Promise<WechatSession>;
}