export class EventKeyConflictError extends Error {
  constructor() {
    super("Event key was reused with different run data");
  }
}
export class HuntTransitionError extends Error {}
export class HuntClaimError extends Error {}
