# Hashcoin ($HASH)

Memecoin + GPU-mining platform. **Read `docs/PROJECT.md` first.** It is the project memory (all decisions, numbers, open questions). Keep it updated when decisions change.

- Architecture: `docs/ARCHITECTURE.md`
- Ordered build plan: `docs/TECHNICAL-PLAN.md` (start here for what to do next)
- Website: static front end in `apps/web` (`index.html`, `calculator.html`, `faq.html`; see `apps/web/README.md`). Brand: logo in `apps/web/brand/logo/`, gold #EBB447, no 3D models. Design brief: `docs/DESIGN-BRIEF.md`
- Payout engine: `packages/engine` (TypeScript). Run `npm test` and `npm run typecheck` from the repo root.
- Simulation: `python3 sim/hashsim.py` (stdlib only)
- Calculators: `calculator/index.html`, `calculator/creator.html` (published as claude.ai artifacts; links in PROJECT.md)

Rules:
- Never commit keys, seed phrases or `.env` files. Use devnet and throwaway keys in sessions.
- Never write marketing copy that promises returns ("pays for itself", "free", "guaranteed").
