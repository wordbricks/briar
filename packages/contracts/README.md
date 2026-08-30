# Briar contracts

`proto/` is the authored source of truth for Briar-owned, cross-language wire
contracts. The checked-in `briar.contracts.image.binpb` is the compiled Buf
image consumed by every code generator, so TypeScript, Swift, and Rust are
derived from the exact same descriptor graph.

Run `mise exec -- bun run contracts:generate` after editing a proto. The
command refreshes the compiled image and all generated language bindings.
`mise exec -- bun run contracts:check` verifies lint, image currentness,
generated source currentness, and compilation of the Rust bindings. `mise
install` bootstraps Buf and every pinned local generator; generation does not
depend on BSR plugin availability or quota.

Swift output is split into two Xcode modules under `swift/Sources/`:
`BriarContracts` contains the public protobuf messages and generated Connect
clients used by the app, while `BriarContractsMocks` contains the official
Connect-Swift generated mocks and is linked only by the iOS test target.

Protobuf packages remain bounded by transport and ownership. `briar.app.v1`
defines the Connect app control plane, `briar.worker.v1` defines the machine
Worker queue control plane, `briar.sidecar.v1` defines the framed runner
protocol, `briar.realtime.v1` defines WebSocket frames, and `briar.types.v1`
contains the small set of values truly shared by those boundaries. Effect
schemas remain responsible for domain invariants and cross-field rules that
protobuf cannot express.
