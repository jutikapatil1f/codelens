import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

@Entity('analyses')
export class Analysis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Owner of this analysis. Indexed for fast per-user listing.
  @Index()
  @Column('uuid')
  userId: string;

  @Column({ default: 'plaintext' })
  language: string;

  @Column('text')
  code: string;

  @Column({ default: 'pending' })
  status: AnalysisStatus;

  // The AI-produced analysis. Null until the job completes.
  @Column('text', { nullable: true })
  result: string | null;

  // Populated when status is 'failed'.
  @Column('text', { nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
