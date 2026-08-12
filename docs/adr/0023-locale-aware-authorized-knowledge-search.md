# ADR 0023: Use locale-aware full-text search inside the authorization query

**Status:** Accepted  
**Date:** 2026-08-12

## Context

Ask Guild searched every language with PostgreSQL's `simple` text-search configuration. An English
question such as "What is the production operating baseline?" therefore required common words such
as "what", "is", and "the" to exist in a Knowledge record. The matching canonical record could be
missed even though its title contained every meaningful term.

Retrieval must remain inside the SQL authorization boundary. Fetching a wider unfiltered result set
and removing inaccessible Knowledge in application code would risk placing unauthorized text in a
model context.

## Decision

The authorized canonical Knowledge query accepts the requested application locale. English uses
PostgreSQL's built-in `english` configuration for stop-word removal and stemming. Japanese and
Simplified Chinese continue to use `simple` plus the existing literal substring fallback until a
reviewed multilingual derived search index is introduced.

The locale changes only tokenization and ranking. Guild, Space, visibility, classification,
Membership, Role, and explicit-Identity predicates remain in the same SQL query and are evaluated
before any candidate leaves PostgreSQL. An integration test covers an English natural-language
question and confirms that only the authorized canonical record is returned.

## Alternatives

- Strip a hand-maintained English stop-word list in the Worker: rejected because PostgreSQL already
  provides tested language processing and keeping query semantics in one layer is easier to audit.
- Retrieve broad candidates and filter them in the Worker: rejected because authorization must
  happen before data enters application or model context.
- Make Vectorize the source of truth: rejected because a search index is derived data and cannot
  replace PostgreSQL authorization or canonical records.

## Risks and rollback

PostgreSQL's built-in English stemming can broaden matches, but ranking and the bounded context limit
remain in force. Japanese and Chinese retrieval remains literal unless content contains searchable
spacing; this is a documented extension point rather than an authorization shortcut. Roll back by
reverting this ADR and the locale parameter together; no schema or stored data changes are involved.
