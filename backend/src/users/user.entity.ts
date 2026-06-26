// TypeORM entity for the `users` table — the persisted account record that
// auth reads/writes (email + bcrypt hash + timestamps).
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Unique so the same email can't register twice (one account per address).
  @Column({ unique: true })
  email: string;

  // Stored as a bcrypt hash, never plaintext. Excluded from default selects.
  @Column({ select: false })
  passwordHash: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
