import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.ts';
import { OfflineService } from './offline.service.ts';

@ApiTags('Offline workspace')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('offline')
export class OfflineController {
  constructor(private readonly offline: OfflineService) {}

  @Get('snapshot')
  @Header('Cache-Control', 'private, no-store')
  snapshot(@CurrentUser() user: AuthUser) {
    return this.offline.snapshot(user);
  }
}
