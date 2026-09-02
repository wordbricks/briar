export interface Resource<Implementation, RemoteManager = unknown, ControlledManager = unknown> {
  readonly symbol: symbol;
  readonly remoteImplementation: (manager: RemoteManager) => Implementation;
  readonly registerControlledImplementation: (
    implementation: Implementation,
    manager: ControlledManager,
  ) => void;
}

export interface RemoteResource<Implementation, RemoteManager> {
  readonly symbol: symbol;
  readonly remoteImplementation: (manager: RemoteManager) => Implementation;
}

export interface ResourceAccessor<RemoteManager> {
  get<Implementation>(resource: RemoteResource<Implementation, RemoteManager>): Implementation;
}

export interface RegisteredControlledResource<ControlledManager> {
  readonly symbol: symbol;
  readonly registerControlledImplementation: (
    implementation: unknown,
    manager: ControlledManager,
  ) => void;
}

export const createResource = <Implementation, RemoteManager = unknown, ControlledManager = unknown>(
  remoteImplementation: (manager: RemoteManager) => Implementation,
  controlledImplementation: (
    implementation: Implementation,
    manager: ControlledManager,
  ) => void,
): Resource<Implementation, RemoteManager, ControlledManager> => ({
  symbol: Symbol(),
  remoteImplementation,
  registerControlledImplementation: controlledImplementation,
});

export const resourceEntry = <Implementation, RemoteManager, ControlledManager>(
  resource: Resource<Implementation, RemoteManager, ControlledManager>,
  implementation: Implementation,
): readonly [Resource<Implementation, RemoteManager, ControlledManager>, Implementation] => [
  resource,
  implementation,
];

export class RemoteResourceAccessor<RemoteManager> implements ResourceAccessor<RemoteManager> {
  constructor(private readonly remoteManager: RemoteManager) {}

  get<Implementation>(resource: RemoteResource<Implementation, RemoteManager>): Implementation {
    return resource.remoteImplementation(this.remoteManager);
  }
}

class ResourceDescriptor<ControlledManager> {
  constructor(
    readonly resource: RegisteredControlledResource<ControlledManager>,
    readonly value: unknown,
  ) {}
}

export class RegistryResourceAccessor<ControlledManager> {
  private readonly resources = new Map<symbol, ResourceDescriptor<ControlledManager>>();

  register<Implementation, RemoteManager>(
    resource: Resource<Implementation, RemoteManager, ControlledManager>,
    value: Implementation,
  ): void {
    this.resources.set(
      resource.symbol,
      new ResourceDescriptor(
        resource as unknown as RegisteredControlledResource<ControlledManager>,
        value,
      ),
    );
  }

  get<Implementation, RemoteManager>(
    resource: Resource<Implementation, RemoteManager, ControlledManager>,
  ): Implementation | undefined {
    return this.resources.get(resource.symbol)?.value as Implementation | undefined;
  }

  entries(): Array<readonly [RegisteredControlledResource<ControlledManager>, unknown]> {
    return [...this.resources.values()].map(({ resource, value }) => [resource, value]);
  }
}

export class CombinedResourceAccessor<RemoteManager> implements ResourceAccessor<RemoteManager> {
  private readonly localResources = new Map<symbol, unknown>();

  constructor(
    private readonly baseAccessor: ResourceAccessor<RemoteManager>,
    localResourceEntries: ReadonlyArray<
      readonly [RemoteResource<unknown, RemoteManager>, unknown]
    >,
  ) {
    for (const [resource, implementation] of localResourceEntries) {
      this.localResources.set(resource.symbol, implementation);
    }
  }

  get<Implementation>(resource: RemoteResource<Implementation, RemoteManager>): Implementation {
    if (this.localResources.has(resource.symbol)) {
      return this.localResources.get(resource.symbol) as Implementation;
    }
    return this.baseAccessor.get(resource);
  }
}
