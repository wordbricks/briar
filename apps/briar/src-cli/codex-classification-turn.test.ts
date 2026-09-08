import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCodexClassificationTurn } from "./codex-classification-turn";
import type { DetachedProviderTurnInput } from "./detached-provider-turn";

async function fixture(supported = true) {
  const directory = await mkdtemp(join(tmpdir(), "briar-classification-test-"));
  const binary = join(directory, "codex");
  await writeFile(binary, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
if (process.argv.includes('generate-json-schema')) {
  const out = process.argv[process.argv.indexOf('--out') + 1];
  fs.mkdirSync(path.join(out, 'v2'));
  fs.writeFileSync(path.join(out, 'v2', 'ThreadStartParams.json'), JSON.stringify({properties: ${supported ? "{environments:{type:['array','null']}}" : "{}"}}));
  fs.appendFileSync(path.join(process.env.BRIAR_READ_ONLY_STATE_ROOT, 'schema-calls'), '1');
  process.exit(0);
}
fs.writeFileSync('started', '1');
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({id:m.id,result:{}});
  if (m.method === 'thread/start') {
    assert.deepEqual(m.params.environments, []);
    assert.deepEqual(m.params.selectedCapabilityRoots, []);
    assert.deepEqual(m.params.dynamicTools, []);
    assert.equal(m.params.ephemeral, true);
    assert.equal(m.params.config.features.shell_tool, false);
    assert.equal(m.params.config.features.apps, false);
    assert.equal(m.params.config.features.plugins, false);
    assert.equal(m.params.config.features.computer_use, false);
    assert.equal(m.params.config.web_search, 'disabled');
    send({id:m.id,result:{thread:{id:'test-thread'}}});
  }
  if (m.method === 'turn/start') {
    assert.deepEqual(m.params.outputSchema, {type:'object'});
    send({id:m.id,result:{}});
    send({id:'attempt',method:'item/commandExecution/requestApproval',params:{command:'write forbidden'}});
  }
  if (m.id === 'attempt') {
    assert.equal(m.error.code, -32601);
    assert.equal(m.result, undefined);
    send({method:'turn/completed',params:{turn:{status:'completed',items:[{type:'agentMessage',phase:'final_answer',text:'{"mode":"execute"}'}]}}});
  }
});
`, { mode: 0o700 });
  const input: DetachedProviderTurnInput = {
    agent: { id: "router", name: "Router", provider: "codex", model: "gpt-6-astra",
      effort: "medium", responsibility: "Classify only.", skills: [] },
    prompt: "Classify this request", workspacePath: directory, fullAccess: false, readOnly: true,
    executionTools: "disabled", outputSchema: { type: "object" },
    environment: { ...process.env, BRIAR_READ_ONLY_STATE_ROOT: directory },
    signal: AbortSignal.timeout(10_000),
  };
  return { directory, binary, input };
}

describe("Codex classification isolation", () => {
  it("uses an environment-free ephemeral thread, rejects server execution requests and caches capability checks", async () => {
    const { directory, binary, input } = await fixture();
    try {
      for (let run = 0; run < 2; run++) {
        expect(await runCodexClassificationTurn(input, binary)).toMatchObject({
          completed: true, resultText: '{"mode":"execute"}', conversationId: null,
        });
      }
      expect(await readFile(join(directory, "schema-calls"), "utf8")).toBe("1");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("does not start app-server when the installed protocol cannot disable environments", async () => {
    const { directory, binary, input } = await fixture(false);
    try {
      await expect(runCodexClassificationTurn(input, binary)).rejects.toThrow("codex_classification_isolation_unsupported");
      await expect(readFile(join(directory, "started"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
