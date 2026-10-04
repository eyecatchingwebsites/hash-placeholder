# Hashcoin ($HASH)

A Solana token plus a GPU-mining platform (presented as a real product, not a joke memecoin): spare GPU power on everyday PCs becomes nonstop buying of $HASH, and a 5% tax on every trade pays miners and holders. **New session? Read `docs/HANDOFF.md` first** (branch, how to resume, how the user likes to work), then **`docs/PROJECT.md`**, the project memory (all decisions, numbers, open questions). Keep it updated when decisions change.

- Architecture: `docs/ARCHITECTURE.md`
- Ordered build plan: `docs/TECHNICAL-PLAN.md` (start here for what to do next)
- Website: static front end in `apps/web` (`index.html`, `calculator.html`, `faq.html`; see `apps/web/README.md`). Live preview: https://claude.ai/artifact/6mwmqXA78PGKKqr17gNmSc. After a change: `python3 apps/web/scripts/build_standalone.py`, check with `node apps/web/scripts/check_site.mjs`, republish (`apps/web/scripts/artifact_page.py`). Brand: logo in `apps/web/brand/logo/`, gold #EBB447, no 3D models. Design brief: `docs/DESIGN-BRIEF.md`
- Payout engine: `packages/engine` (TypeScript). Run `npm test` and `npm run typecheck` from the repo root.
- Simulation: `python3 sim/hashsim.py` (stdlib only)
- Calculators: `calculator/index.html`, `calculator/creator.html` (published as claude.ai artifacts; links in PROJECT.md)

Rules:
- Never commit keys, seed phrases or `.env` files. Use devnet and throwaway keys in sessions.
- Never write marketing copy that promises returns ("pays for itself", "free", "guaranteed").
- Never claim "first" beyond the researched wording in `docs/PROJECT.md` §13 ("The first token your GPU gets paid to buy").
- Website copy stays short and plain; no tag/pill labels above titles, no monospace uppercase labels (user: "AI slop").
