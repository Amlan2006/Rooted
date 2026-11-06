export function parseProviderRequest(value: unknown): { block_hash: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provide an optional block hash.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "block_hash") || (record.block_hash !== undefined && typeof record.block_hash !== "string")) throw new Error("Only block_hash is accepted; provider endpoints are server configuration.");
  const hash = String(record.block_hash || "").trim().toLowerCase();
  if (hash && !/^0x[0-9a-f]{64}$/.test(hash)) throw new Error("Enter a 32-byte execution block hash.");
  return { block_hash: hash };
}
