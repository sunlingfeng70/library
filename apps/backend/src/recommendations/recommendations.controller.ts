import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthPrincipal } from '../auth/auth-principal';
import { Recommender } from './recommender.service';

@Controller('recommendations')
@UseGuards(JwtAuthGuard)
export class RecommendationsController {
  constructor(private readonly recommender: Recommender) {}

  @Get()
  listMine(@CurrentUser() user: AuthPrincipal) {
    if (user.kind !== 'reader') {
      throw new ForbiddenException('仅读者可查看推荐');
    }
    return this.recommender.recommend(user.id);
  }
}
