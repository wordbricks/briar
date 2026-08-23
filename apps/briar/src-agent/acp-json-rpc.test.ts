import { describe, expect, it } from "vitest";
import { AcpJsonRpcConnection } from "./acp-json-rpc";

const fakeAcpSource = `
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const boundary = buffer.indexOf("\\n");
  if (boundary < 0) return;
  const request = JSON.parse(buffer.slice(0, boundary));
  process.stdout.write(JSON.stringify({ id: request.id, method: 42 }) + "\\n");
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id: request.id,
    result: "pong",
  }) + "\\n");
});
`;

describe("ACP JSON-RPC transport", () => {
  it("ignores an invalid line and continues with the next valid response", async () => {
    const connection = new AcpJsonRpcConnection({
      providerName: "Fake",
      command: process.execPath,
      arguments: ["--eval", fakeAcpSource],
      cwd: process.cwd(),
      environment: process.env,
    });

    try {
      await expect(connection.request("ping")).resolves.toBe("pong");
    } finally {
      connection.close();
    }
  });
});
