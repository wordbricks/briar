# Mobile HTTP contracts

This package is the executable source of truth for migrated Worker/mobile HTTP
operations. Each operation owns its method, path, security, response status,
Effect schema, and OpenAPI component name.

`listProjects` is the first migrated vertical slice. Its shared schema is used
by the Worker response validator and the Android/Tauri TypeScript decoder. The
same descriptor generates the corresponding OpenAPI path/components and the
checked-in Swift DTO/typed operation.

Security is executable metadata as well: the Worker authentication helper
applies it, while the TypeScript and generated Swift clients make bearer tokens
mandatory only for authenticated operations.

The generator walks every entry in `mobileOperationCatalog`. A migrated
operation is therefore either emitted into both artifacts or generation fails
explicitly when its request/schema shape is not supported yet.

Each migrated operation has one strict response schema. The Worker validator,
OpenAPI, generated Swift DTO, and TypeScript decoder all consume that same
schema; there is no separate compatibility shape.

Run `bun run mobile:contract:generate` after changing a migrated contract. CI
runs `bun run mobile:contract`, which checks generated artifacts and exercises
the real Worker route, response validator, and TypeScript decoders.
