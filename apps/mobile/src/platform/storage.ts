import * as SecureStore from "expo-secure-store";
import { fromBase64Url, toBase64Url, type KeyPair, type PairingPayload } from "@pocketdeck/protocol/crypto";
import type { Persisted } from "../core/connection";

const K = { payload: "pd.payload", secret: "pd.phoneSecret", pub: "pd.phonePub", persisted: "pd.persisted" };
const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export interface Saved {
  payload: PairingPayload;
  keys: KeyPair;
  persisted: Persisted;
}

export async function loadSaved(): Promise<Saved | null> {
  try {
    const [payload, secret, pub, persisted] = await Promise.all(Object.values(K).map((k) => SecureStore.getItemAsync(k, opts)));
    if (!payload || !secret || !pub) return null;
    return {
      payload: JSON.parse(payload) as PairingPayload,
      keys: { secretKey: fromBase64Url(secret), publicKey: fromBase64Url(pub) },
      persisted: persisted ? (JSON.parse(persisted) as Persisted) : { handshakeDone: false },
    };
  } catch {
    return null;
  }
}

export async function savePairing(payload: PairingPayload, keys: KeyPair): Promise<void> {
  await SecureStore.setItemAsync(K.payload, JSON.stringify(payload), opts);
  await SecureStore.setItemAsync(K.secret, toBase64Url(keys.secretKey), opts);
  await SecureStore.setItemAsync(K.pub, toBase64Url(keys.publicKey), opts);
  await SecureStore.setItemAsync(K.persisted, JSON.stringify({ handshakeDone: false }), opts);
}

let pending: Persisted | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Debounced: counters change on every message. */
export function savePersisted(p: Persisted): void {
  pending = p;
  timer ??= setTimeout(() => {
    timer = undefined;
    if (pending) void SecureStore.setItemAsync(K.persisted, JSON.stringify(pending), opts).catch(() => undefined);
  }, 500);
}

export async function clearPairing(): Promise<void> {
  await Promise.all(Object.values(K).map((k) => SecureStore.deleteItemAsync(k, opts).catch(() => undefined)));
}
