// Data-access layer for user accounts: the only place that talks to the users
// table, so all lookups/creation (and the password-hash select rules) live here.
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async create(email: string, passwordHash: string): Promise<User> {
    // Pre-check for a friendly 409 rather than relying on the DB unique
    // constraint to surface as an opaque 500.
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }
    const user = this.users.create({ email, passwordHash });
    return this.users.save(user);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email } });
  }

  // passwordHash is select:false, so explicitly request it for auth checks.
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }
}
