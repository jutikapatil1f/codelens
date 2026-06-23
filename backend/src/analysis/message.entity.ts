import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Who authored a turn in a follow-up conversation. 'user' is the human's
// question; 'assistant' is the model's reply.
export type MessageRole = 'user' | 'assistant';

/**
 * One turn in the follow-up chat attached to an Analysis.
 *
 * The original analysis (code + AI review) is the seed of the conversation;
 * these rows are the back-and-forth that follows. They are loaded in
 * chronological order to both rebuild the thread for the UI and to give the
 * model the prior context on each new question.
 */
@Entity('analysis_messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // The analysis this message belongs to. Indexed for fast per-thread listing.
  @Index()
  @Column('uuid')
  analysisId: string;

  @Column()
  role: MessageRole;

  @Column('text')
  content: string;

  @CreateDateColumn()
  createdAt: Date;
}
