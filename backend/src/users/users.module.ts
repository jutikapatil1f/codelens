// Owns the User entity and its data-access service. Exports UsersService so
// AuthModule can look up and create users without touching the repository directly.
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Module({
  // forFeature registers the User repository for injection in this module.
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  exports: [UsersService], // shared with AuthModule
})
export class UsersModule {}
