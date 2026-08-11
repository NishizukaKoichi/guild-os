# ADR 0014: Bind Conversations to governed Guild records

- Status: Accepted
- Date: 2026-08-12

## Context

Guild members and Agents need to discuss Knowledge, Work, Decisions, Announcements, and Agent runs
without moving operational context into private messaging systems. A standalone chat permission
would be unsafe: someone who lost access to the underlying record could retain access to its
discussion, mentions could disclose membership across Space boundaries, and moderation could erase
the historical reason for a change.

## Decision

- A Conversation belongs to exactly one supported subject: Knowledge, Goal, Project, Quest, Step,
  Decision, Announcement, or Agent Run. A subject can have at most one Conversation.
- The Conversation inherits the subject's current Guild, Space, owner, visibility, classification,
  and explicit audience. Its stored boundary is an audit snapshot, not an independent grant.
- Every read first authorizes the current subject boundary in PostgreSQL. Moving or restricting a
  subject therefore revokes its Conversation immediately, without deleting history.
- Opening or posting requires the underlying subject read permission plus `conversation.read` or
  `conversation.post`. Lock, unlock, and redaction require the human-only
  `conversation.moderate` permission.
- Messages are append-only. Moderation replaces the visible body with a redacted state and retains
  the original row for controlled database recovery and legal policy. Ordinary reads never return
  a redacted body; only authorized moderators receive the redaction reason and actor metadata.
- Mentions target active Humans who currently share access to the subject. Recipient validation and
  Inbox insertion are set-based SQL operations. Agents and Services cannot be mentioned.
- Posting, lock, unlock, and redaction each require a fresh Chronicle event in the same transaction.
  Chronicle records a SHA-256 body digest and mention count, never comment plaintext.
- Pagination is cursor-based and bounded. UI components are contextual panels rather than a global
  chat inbox; v1 exposes them on Knowledge, Quest, and Decision records while the API supports all
  listed subject types.

## Alternatives considered

- **Global channel chat:** rejected because it separates discussion from the governed record and
  makes authorization, retention, and later retrieval ambiguous.
- **Copy the subject boundary once:** rejected because revoked access would continue to expose old
  comments.
- **Hard-delete moderated messages:** rejected because it destroys accountability and makes abuse
  of moderator authority difficult to investigate.
- **Store plaintext in Chronicle:** rejected because audit search should not become a second copy of
  potentially sensitive discussion.

## Consequences

Each supported subject repository must expose its current authorization boundary. New subject
types cannot opt into Conversations until their read permission and boundary resolver are explicit.
Changing a subject's boundary changes Conversation access immediately, while the immutable
Chronicle explains message and moderation history. Database retention and legal deletion policy
must account for redacted message bodies because redaction removes them from normal product views
but does not physically erase the source row.
