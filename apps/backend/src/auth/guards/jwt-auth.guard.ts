import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthPrincipal } from '../auth-principal';

interface RequestLike {
  headers: Record<string, string | undefined>;
  user?: AuthPrincipal;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const authorization = request.headers['authorization'];
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    const token = authorization.slice('Bearer '.length);
    try {
      const payload = await this.jwtService.verifyAsync<AuthPrincipal>(token);
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('invalid token');
    }
  }
}