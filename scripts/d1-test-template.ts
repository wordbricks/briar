import {
  cleanD1TestTemplates,
  prepareD1TestTemplate,
} from "../worker/src/test-helpers/d1";

if (process.argv.includes("--clean")) {
  await cleanD1TestTemplates();
} else {
  const template = await prepareD1TestTemplate();
  console.info(
    `[d1-test] ready: ${template.cacheHit ? "reused" : "generated"}; ` +
      `${template.manifest.migrations.length} migrations; ` +
      `${template.manifest.schemaObjects} schema objects`,
  );
}
