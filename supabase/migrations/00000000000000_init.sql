-- Phase 0: confirms the Postgres connection works. No feature tables yet —
-- those land in Phase 2 onward (see Appendix A of the build plan and the
-- per-phase migration files that will be added alongside them).
--
-- Every table added from Phase 2 onward must enable Row Level Security in
-- the same migration that creates it — do not defer RLS to a later pass.

select 1;
