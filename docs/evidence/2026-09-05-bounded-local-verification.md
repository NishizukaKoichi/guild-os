# Bounded Local Verification Receipt

Date: 2026-09-05 (Australia/Sydney)

Guild OS is incomplete. This receipt records credential-free local engineering evidence only. It
is not independent purchaser evidence, production signing custody, authenticated staging evidence,
a legal opinion, or permission to publish or deploy.

## Commit binding

- Base commit: `c7183f13219b47ab7bf00c2220e4976cb2dffa0f`.
- Verified implementation commit: `bd5fa87cda5f5db8173ecd07a0ad066e73ba4013`.
- Verified implementation tree: `80be58123c6d52a1b2a6518b677f0f4e64a62090`.
- Dedicated branch: `wand/guild-verification-066a4878`.
- Worktree: `/Volumes/Pensive/Workspace/NishizukaKoichi/.worktrees/guild-os-wand-066a4878`.
- Cloudflare OS gitlink: `2328903` + `878b8bb3d8e29af6187abe935a5738482`
  (concatenate the two hexadecimal segments).

The commit that introduces this receipt is an evidence-only documentation successor to the
verified implementation commit. It must not be substituted for the source-under-test in log,
bundle, smoke, or Distribution claims. Git history and the follow-up receipt-binding record identify
that documentation commit without attempting the impossible self-reference of embedding a commit's
own hash inside its content.

## Local results

| Gate | Observed result |
| --- | --- |
| Frozen install | Passed |
| Typecheck, build, lint, peer check | Passed |
| Dependency audit | Passed; zero known vulnerabilities |
| Default `pnpm test` | 395 passed overall: 119 Node test assertions plus a 276 Vitest assertion subtotal |
| Database cases in the default command | 73 skipped there by design and all 73 passed in the separate PostgreSQL integration run |
| PostgreSQL integration | 19 files and 73 tests passed |
| Gatekeeper PostgreSQL integration | 14 files and 35 tests passed |
| Database contract | 51 migrations and 96 forced-RLS tables verified with a non-superuser, non-BYPASSRLS Runtime role |
| Cloudflare OS | 496 passed, including mandatory replay of the four upstream RPC cases that remain skipped in the upstream suite |
| Worker build | Five Worker bundles passed dry-run; no upload occurred |
| Browser E2E | 74 passed |
| Completion report | Parsed all 42 rows and correctly returned `productCompletionVerified=false` |

The default test total is 395. The number 276 is only the Vitest subtotal and must never be reported
as the complete default-test count.

## PostgreSQL boundary

The final functional database evidence used a worktree-contained PostgreSQL 18.6 build on loopback
port 55439 with password-free fixture roles and no shared or production data. PostgreSQL itself had
only `/usr/lib/libSystem.B.dylib` as an external dynamic dependency. `pg_trgm` 1.6, `pgcrypto` 1.4,
and pgvector 0.8.2 were installed only under the worktree-local PostgreSQL prefix for this recheck.
The fixture server was stopped after testing.

This was a repaired verification toolchain, not a successful one-shot clean bootstrap. The first
migration run applied migrations 0001 through 0037 and then failed while loading the locally built
`pgcrypto` at migration 0038. The extension was rebuilt against a worktree-local shared OpenSSL
3.0.18 using the installed PostgreSQL PGXS and correct bundle loader. The migration then resumed
through 0051, a repeat migration was a no-op success, Runtime provisioning and preflight passed, and
the 73 plus 35 functional integration tests passed. Failed setup logs remain part of the ignored
local ledger and are not concealed by this receipt.

Source pins used for the repaired local toolchain:

- PostgreSQL 18.6 archive SHA-256: `555610c24d53e4316da5b7d3fc25c279d96856d5e0e23ee308c328c5fa881d9f`.
- OpenSSL 3.0.18 archive SHA-256: `d80c34f5cf902dccf1f1b5df5ebb86d0392e37049e5d73df1b3abae72e4ffe8b`.
- pgvector commit: `cab9da72c04353f143bb06b42ab70a403daac64a`.

## Distribution rehearsal

A temporary ignored clone of Distribution commit
`d75ee8b8e124ec7ad28f927a7f5c21002a633c40` was pinned to the verified implementation commit.
Its local evidence-only commit was `eed365ccfd906f6c2c3d9a843b136e6c9e53a3e0` and the Core bundle
SHA-256 was `f7038916ce43a01bc791f443388e543ffe6155f0189f62d89359fda90a0b488a`.
All 63 tests and 17 release-gate steps passed. The generated report explicitly records synthetic
clean-room and ephemeral signing rehearsal as true, while production signing, independent purchaser,
authenticated staging, purchaser infrastructure, and production change evidence remain false.
The canonical Distribution repository was not modified.

## Evidence hashes

The following ignored local artifacts bind full logs and machine-readable results. They are retained
locally but are not source-controlled or valid substitutes for independent external evidence.

- Completion recheck receipt SHA-256: `f8b560d1727ee2e3955d53578f9b0629fa4ee4d234d4c80c7085e797259c6b34`.
- PostgreSQL recheck receipt SHA-256: `7fc8614712b7dffd0b02181210c453bbd805b430db00813d3d688d0db44e6707`.
- Existing pgvector scope-exception manifest SHA-256: `3f927703471d19c64b73b5d3329833c5dbdd1e255b37c3e9004b0e1dd48f8d04`.
- Local credential-exposure exception SHA-256: `1200c6d70bfcdc2190005093ccc62b86719ce62909c6e2093e3841d4eb4766ac`.
- Successor Distribution report SHA-256: `7493acc742e6684d6f390c4b17e35e77afd2c63aabb17f1acd29c615a5913354`.

## Unresolved exceptions and completion boundary

- A prior out-of-scope pgvector install recorded 42 paths under `/opt/homebrew`. This recheck did
  not delete, restore, overwrite, or otherwise resolve those paths. A separately authorized local
  operator must audit the exact manifest before any targeted action; broad uninstall is prohibited.
- An existing npm registry credential was exposed to hidden local command output during an earlier
  configuration inspection. Its value is not recorded here. It was not used, copied, persisted, or
  changed by this task. The account owner must revoke or rotate it through the official npm security
  interface on a trusted device and verify that the old credential is rejected.
- Candidate exact-SHA hosted CI, independent purchaser install/update/rollback/restore, production
  signing custody on physically independent devices, professional legal/commercial review, and
  authenticated staging or production evidence remain absent.
- Completion Matrix sections 3, 6, 27, 29, 30, 37, 38, 39, 40, 41, and 42 remain open.
- `productComplete=false` remains the only valid product-level conclusion.

No push, merge, deployment, authentication or permission change, credential rotation, billing
action, production database access, or data deletion occurred during this bounded verification.
