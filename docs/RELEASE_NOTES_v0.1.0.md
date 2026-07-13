# Lattice v0.1.0 — First Public Release 🌀

The first public release of **Lattice**, a **Deterministic Agent-Oriented
Programming (DAOP)** framework: build mathematically safe, parallelized,
microsecond-fast agentic workflows in TypeScript, powered by a high-performance
Rust A\* planning core.

Unlike stochastic LLM-based agent frameworks — which hallucinate, are slow, and
cost unpredictably — Lattice computes the optimal plan of action with a 100%
deterministic, symbolic engine. You declare *what state you want*; Lattice
figures out *how to get there*, and replans when the world changes.

## ✨ Highlights

- 🦀 **High-performance Rust core** — optimal A\* graph-search planner.
- ⚡ **Persistent TCP IPC daemon** — background daemon that keeps IPC planning
  transactions in the single-digit-millisecond range.
- 🔀 **Parallel DAG scheduler** — automatically detects RAW/WAW/WAR hazards and
  groups independent actions into parallel tiers executed via `Promise.all`.
- 🧠 **Skill-tree caching** — canonical state-goal hashing gives O(1) plan lookups,
  persisted to disk.
- 🔍 **Rich predicates & mutators** — `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
  in preconditions; `$add`, `$sub`, `$set` in effects.
- 🌐 **Dual transport** — run the planner via the TCP daemon or in-process via WASM.
- 🪜 **HTN support** — hierarchical compound tasks with methods and sub-tasks.
- 🩹 **Reactive agent loop** — sensors re-perceive the world and the agent
  self-corrects by replanning on precondition failures.
- 🎨 **DevTools visualizer** — colored ASCII decision trees in the console plus an
  interactive HTML search-space explorer.

## 📖 Documentation

- **README** — features, architecture (Rust core vs. TypeScript client), quick
  start and a full code example.
- **[docs/VISION.md](../docs/VISION.md)** — where Lattice fits in the 2026
  neurosymbolic AI stack, grounded use cases, the honest ceiling of the current
  core, and the value layers you can build on top.
- **CONTRIBUTING.md** — dev setup, build/test workflow, and how to contribute.

## 🚀 Getting started

```bash
git clone https://github.com/Abick91/Lattice.git
cd Lattice
npm install
npm run build          # builds the Rust core (release) + the TypeScript client
npm run example:ledger # A* reconciliation workflow with a parallel DAG
```

## 📋 Requirements

- Rust (stable) with Cargo
- Node.js 18+ with npm

## ⚠️ Status

This is an early **v0.1.0** release — a solid, correct planning kernel, not a
finished platform. See [docs/VISION.md](../docs/VISION.md) for the current
limitations and the roadmap of what can be built on top.

## 📄 License

MIT
