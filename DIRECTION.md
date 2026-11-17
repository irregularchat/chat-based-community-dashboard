# Direction: Chat-Based Community Dashboard

A self-hosted tool for organizers of large Signal-first chat communities (IrregularChat): a
Next.js admin dashboard for member accounts in Authentik, plus a Signal bot that runs
onboarding, moderation and community commands in the groups.

Status: maintenance (last change 2026-11-14). The last feature work was a burst in
Nov–Dec 2025 (54 commits); since 2025-12-08 the only change is a one-line deploy fix.

## Where it is heading
- The Signal bot has become the centre of the repo. Recent work is almost all under
  `modern-stack/cloudflare-workers/signal-bot/`, not the dashboard UI (82 commits since the
  split from authentik-account-creation; e6b8cbd5e, 064384b1c, e7a0e560a).
- The bot runs in two modes: Cloudflare-native (Worker + D1/R2/Durable Objects) and
  self-hosted (Docker Compose with PostgreSQL). The container picks the mode from `DB_HOST`
  (a621bac0d, e6b8cbd5e, `signal-bot/.claude/rules/deployment.md`).
- Bot features feed the wider community stack: account creation through Authentik SSO
  (`!createuser`), Discourse cross-posting for announcements and breakout reports, wiki
  search with embeddings, and pCloud document archiving (064384b1c, ff0fe46c2, 3a2dcaa50,
  b4ada0829, d8bcdfdaa).
- Breakout rooms, member verification and account invites have written plans
  (`container/PLAN_BREAKOUT_BOT.md`, `container/PLAN_VERIFICATION_SYSTEM.md`,
  `container/PLAN_ACCOUNTINVITE.md`). Breakout Phases 1–3 are marked done (7c28dbe2d, 3a2dcaa50).
- Deploys are meant to run unattended from scripts, not by hand (65bc57ef5, deployment.md).

## Priorities
1. Security and data hygiene review (tracked privately).
2. Confirm which Signal bot deployment is live and canonical: this repo's self-hosted mode,
   its Cloudflare mode, or the IrregularChat monorepo's `signal-messenger` service. Work
   follows that answer (see open questions).
3. Finish or close the open bot plans: verification/vouching flow, account-invite command,
   and the summarization phases still marked "Planned" (`PLAN_VERIFICATION_SYSTEM.md`,
   `PLAN_ACCOUNTINVITE.md`, `SUMMARIZATION_ROADMAP.md`) (inferred order).
4. Reduce clutter: ~25 one-off bot scripts in `modern-stack/` (`ultimate-signal-bot.js`,
   `production-ready-signal-bot-fixed.js`, …) and many status/summary docs repeat each other
   (inferred).

## Non-goals and constraints
- Stack: Next.js 15, TypeScript, Prisma, tRPC, NextAuth for the dashboard. The Streamlit
  version is archived on the `legacy-streamlit` branch; don't extend it (88e346e, README.md).
- The bot talks to signal-cli through the native daemon over JSON-RPC, not the REST API
  (modern-stack/ROADMAP.md v0.2.2).
- Signal replies are plain text. Markdown formatting was removed on purpose
  (aed4cb891, 5d05c653d).
- Admin-only commands stay protected, and admins/owners can't be removed by bot commands
  (064384b1c). Destructive commands ask for confirmation (6052a7c0e).
- Low-value commands get removed rather than kept (834bdf09b removed `!whoami`, `!version`, `!stats`).
- Deploys: never `rsync --delete` to a service's parent directory. Use the deploy scripts,
  dry-run first, rebuild images with `--build`/`--no-cache`, and verify the new code is in
  the container (deployment.md, after the 2025-12-03 data-loss incident).
- Never commit Signal data, `.env` or deploy env files (f11d306b2 `.gitignore`).
- `CLUADE.md` at the root is a template copied from another project ("OmniCore", conda
  environments, alembic). Don't treat it as this repo's rules.

## Decisions
- 2026-11-14: `deploy.sh` defaults the Cloudflare account so unattended deploys work (65bc57ef5)
- 2025-12-05: bot creates Authentik accounts via `!createuser`; admin protection on `!clearroom` (064384b1c)
- 2025-12-05: breakout rooms with AI summaries, catch-up DMs and Discourse reports (e7a0e560a, 3a2dcaa50)
- 2025-12-05: deployment rules written after the rsync incident (9889696f4)
- 2025-12-02: removed rarely used `!whoami`, `!version`, `!stats` (834bdf09b)
- 2025-11-27: added the self-hosted PostgreSQL mode alongside Cloudflare (e6b8cbd5e)
- 2025-11-18: rewrote the bot as Cloudflare-native: Worker API, container, D1, R2, Durable Objects (a621bac0d)
- 2025-10-27: stopped tracking Signal data and env files (f11d306b2)
- 2025-09-07: strip markdown from all Signal bot responses (aed4cb891)
- 2025-08-15: moved to the Next.js stack and archived Streamlit (88e346e)

## Open questions for the owner
1. Is the Signal bot still developed here, or did it move to the IrregularChat monorepo
   (`selfhost/messaging-apps/signal-messenger`, which ai-coding-env docs cite)? If it moved,
   should this repo be frozen or archived?
2. Is the Cloudflare-native mode still used? The 2026-11-14 fix suggests yes, but the
   ops docs elsewhere only describe the self-hosted container.
3. Is the Next.js dashboard deployed anywhere? The dotfiles service audit lists its
   host directory with an empty compose file.

## Related documents
- `modern-stack/ROADMAP.md` (dashboard roadmap, last updated Aug 2025), `ROADMAP.md`,
  `modern-stack/COMPREHENSIVE_ROADMAP.md`, `SIGNAL_CLI_BOT_ROADMAP.md`
- `modern-stack/cloudflare-workers/signal-bot/`: `README.md`, `ARCHITECTURE.md`,
  `SELF_HOSTED_DEPLOYMENT.md`, `.claude/rules/deployment.md`, `SUMMARIZATION_ROADMAP.md`,
  `SALVAGED_FEATURES_PLAN.md`, `container/PLAN_*.md`
- `modern-stack/LESSONS_LEARNED.md`, `modern-stack/SIGNAL_LESSONS_LEARNED.md`
