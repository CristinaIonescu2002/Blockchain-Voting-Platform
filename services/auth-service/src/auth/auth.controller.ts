import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { LinkWalletDto } from './dto/link-wallet.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from './entities/user.entity';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // POST /auth/register
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  // POST /auth/login
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // POST /auth/refresh  — body: { refreshToken }
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body('refreshToken') token: string) {
    return this.auth.refresh(token);
  }

  // POST /auth/logout  — requires Bearer token
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser() user: User) {
    return this.auth.logout(user.id);
  }

  // POST /auth/link-wallet  — requires Bearer token
  @Post('link-wallet')
  @UseGuards(JwtAuthGuard)
  linkWallet(@CurrentUser() user: User, @Body() dto: LinkWalletDto) {
    return this.auth.linkWallet(user.id, dto.walletAddress);
  }

  // GET /auth/me  — requires Bearer token
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: User) {
    return this.auth.me(user.id);
  }
}
