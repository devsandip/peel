export function renderBootstrap(
  source: string,
  leaseHelper: string,
  healthHelper: string,
) {
  for (const placeholder of ["__LEASE_HELPER__", "__HEALTH_HELPER__"])
    if (source.split(placeholder).length !== 2)
      throw new Error("Ambiguous bootstrap helper placeholder");
  return source
    .replace("__LEASE_HELPER__", () => leaseHelper)
    .replace("__HEALTH_HELPER__", () => healthHelper);
}
