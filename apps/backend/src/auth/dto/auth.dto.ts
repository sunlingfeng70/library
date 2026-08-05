import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class WechatLoginDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class BindReaderDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  cardNumber!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

export class StaffLoginDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}