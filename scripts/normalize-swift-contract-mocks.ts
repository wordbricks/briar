import { resolve } from "node:path"

const [mockRootArgument] = process.argv.slice(2)

if (mockRootArgument === undefined) {
  throw new Error("usage: normalize-swift-contract-mocks.ts <generated-mock-root>")
}

const mockRoot = resolve(mockRootArgument)
const generatedMocks = new Bun.Glob("**/*.mock.swift")
const mockPaths: Array<string> = []

for await (const relativePath of generatedMocks.scan({ cwd: mockRoot, onlyFiles: true })) {
  mockPaths.push(resolve(mockRoot, relativePath))
}

mockPaths.sort()

if (mockPaths.length === 0) {
  throw new Error(`no generated Swift mocks found under ${mockRoot}`)
}

const streamingMock = /\bMock(?:Bidirectional|ClientOnly|ServerOnly)(?:Async)?Stream\b/
const connectMocksImport = /^import ConnectMocks\r?\n/gm

for (const mockPath of mockPaths) {
  const source = await Bun.file(mockPath).text()

  if (streamingMock.test(source)) {
    throw new Error(
      `streaming mock generated at ${mockPath}; restore the ConnectMocks runtime dependency`,
    )
  }

  const imports = source.match(connectMocksImport) ?? []
  if (imports.length > 1) {
    throw new Error(`multiple ConnectMocks imports generated at ${mockPath}`)
  }
  if (imports.length === 0) {
    continue
  }

  await Bun.write(mockPath, source.replace(connectMocksImport, ""))
}
