# Contributing to Lattice

Thanks for your interest in improving Lattice! This project is a deterministic
agent-planning engine with a **Rust core** and a **TypeScript eDSL**, so most
contributions touch one or both sides.

## Prerequisites

- [Rust (stable)](https://rustup.rs/) with `cargo`
- [Node.js 18+](https://nodejs.org/) with `npm`

## Getting started

```bash
git clone https://github.com/Abick91/lattice.git
cd lattice
npm install
npm run build        # builds the Rust core (release) + the TypeScript client
```

Run an example end-to-end:

```bash
npm run example:ledger   # A* reconciliation workflow with a parallel DAG
npm run example:htn      # Hierarchical Task Network (compound tasks)
```

## Project layout

| Path                                   | What it is                                            |
| -------------------------------------- | ----------------------------------------------------- |
| `src/*.rs`                             | Rust planning core (A* search, tools, skill tree, DAG)|
| `lattice_engine_core.rs`               | Rust library entry point (module wiring)              |
| `src/main.rs`                          | `lattice-daemon` TCP IPC binary                       |
| `lattice_client_server_interface.ts`  | TypeScript client / eDSL (`LatticeAgent`, types)      |
| `lattice_bridge.ts`                    | Public re-export surface for consumers                |
| `lattice_*_example.ts`                 | Runnable examples                                     |
| `lattice_devtools.html`               | Interactive A* search-space visualizer                |

## Development workflow

**Rust:**
```bash
cargo build --release   # build the core + daemon
cargo test              # run the unit tests
cargo fmt               # format
cargo clippy            # lint
```

**TypeScript:**
```bash
npx tsc                 # type-check + compile to dist/
```

Please make sure `cargo test` passes and `cargo build --release` / `npx tsc`
are warning-free before opening a pull request.

## Pull requests

1. Fork the repo and create a topic branch (`git checkout -b feat/my-change`).
2. Keep changes focused; match the surrounding code style.
3. Add or update tests for behavior changes (Rust unit tests live in the
   `#[cfg(test)]` modules next to the code).
4. Update the README/examples if you change public behavior or the eDSL.
5. Open a PR describing the motivation and the change.

## Reporting bugs

Open an issue with a minimal reproduction: the initial state, the tool
definitions, the goal, and the plan you expected vs. what Lattice produced.
The DevTools telemetry (from `enableDevTools: true`) is very helpful.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
