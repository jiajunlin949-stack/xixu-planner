let pendingRoute: string = '';
let routeHandler: (() => void) | undefined = undefined;

export function setStartupRoute(value: string): void {
  pendingRoute = value === 'memory' ? 'memory' : value === 'task' ? 'task' : '';
  if (pendingRoute && routeHandler) { routeHandler(); }
}

export function consumeStartupRoute(): string {
  const value: string = pendingRoute;
  pendingRoute = '';
  return value;
}

export function registerStartupRouteHandler(handler: () => void): void {
  routeHandler = handler;
}

export function unregisterStartupRouteHandler(): void {
  routeHandler = undefined;
}
