export function expectedMcpAuthorizationOrigin(input: {
  requestUrl: string;
  configuredPublicUrl?: string;
}) {
  const configuredPublicUrl = input.configuredPublicUrl?.trim();
  return new URL(configuredPublicUrl || input.requestUrl).origin;
}

export function isValidMcpAuthorizationOrigin(input: {
  requestOrigin: string | null;
  requestUrl: string;
  configuredPublicUrl?: string;
}) {
  if (!input.requestOrigin) return true;
  return (
    input.requestOrigin ===
    expectedMcpAuthorizationOrigin({
      requestUrl: input.requestUrl,
      configuredPublicUrl: input.configuredPublicUrl,
    })
  );
}
