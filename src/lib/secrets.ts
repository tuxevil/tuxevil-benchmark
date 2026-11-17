import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(value: string) {
  const [version, ivHex, tagHex, encryptedHex] = value.split(":");
  if (version !== "v1" || !ivHex || !tagHex || !encryptedHex) throw new Error("Invalid encrypted secret format.");
  const decipher = createDecipheriv(algorithm, encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]).toString("utf8");
}

function encryptionKey() {
  const configured = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error("APP_ENCRYPTION_KEY is required to persist encrypted credentials.");
  if (/^[0-9a-f]{64}$/i.test(configured)) return Buffer.from(configured, "hex");
  return createHash("sha256").update(configured).digest();
}
