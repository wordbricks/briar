# Mobile HTTP contracts

This package is the executable source of truth for migrated Worker/mobile HTTP
operations. Each operation owns its method, path, security, response status,
Effect schemas, OpenAPI component name, and Swift endpoint name.

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

The client response schema may contain compatibility defaults for fields older
servers omitted. The wire response schema describes current server output, so
Worker validation and OpenAPI still require those fields.

Run `bun run mobile:contract:generate` after changing a migrated contract. CI
runs `bun run mobile:contract`, which checks generated artifacts and exercises
the real Worker route, response validator, and TypeScript decoders.
