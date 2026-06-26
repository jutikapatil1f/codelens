import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type ShareAccess = 'view' | 'edit';

/**
 * An invitation granting one email address access to one analysis (snippet).
 * Access is by email: when a user logs in whose account email matches
 * `invitedEmail`, the snippet shows up under "Shared with me". No email is
 * actually sent — this is a pure allowlist.
 */
@Entity('snippet_shares')
@Unique(['analysisId', 'invitedEmail']) // one invite per (snippet, email)
export class SnippetShare {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // The analysis being shared. Indexed for fast per-snippet listing.
  @Index()
  @Column('uuid')
  analysisId: string;

  // The invited person's email, stored lowercased for case-insensitive match.
  // Indexed for the "shared with me" lookup.
  @Index()
  @Column()
  invitedEmail: string;

  // Whether the invitee can only view, or can also edit the shared snippet.
  @Column({ default: 'view' })
  access: ShareAccess;

  // The owner who created the invite (for auditing / display).
  @Column('uuid')
  invitedBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
