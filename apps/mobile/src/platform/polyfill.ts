import * as Crypto from "expo-crypto";

// The crypto library draws randomness from globalThis.crypto.getRandomValues, which Hermes lacks.
const g = globalThis as unknown as { crypto?: { getRandomValues?: unknown } };
if (!g.crypto?.getRandomValues) {
  g.crypto = { ...(g.crypto ?? {}), getRandomValues: Crypto.getRandomValues };
}
