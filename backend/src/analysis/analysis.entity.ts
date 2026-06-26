// The 'analyses' table: a submitted code snippet plus its AI review and status.
// Central record of the feature — the queue, processor, chat, and sharing all
// hang off it.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Status state machine, driven by the processor:
//   pending -> processing -> completed | failed
// 'stale' is set when the owner edits the code, marking the prior result void
// until a re-analysis is requested.
export type AnalysisStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'stale';

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
