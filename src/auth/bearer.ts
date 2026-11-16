export function extractBearerToken(authorization: string | undefined): string {
  if (!authorization) {
    throw new Error("Authorization token is required");
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]?.trim()) {
    throw new Error("Authorization token is required");
  }

  return match[1].trim();
}
