class CloudflareEntrypoint<Environment> {
  protected env: Environment;
  protected ctx: unknown;

  constructor(ctx: unknown, env: Environment) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class DurableObject<Environment> extends CloudflareEntrypoint<Environment> {}

export class WorkflowEntrypoint<Environment> extends CloudflareEntrypoint<Environment> {}
