export type PushFn = (token: string, body: string) => Promise<void>;

/** Content-free push straight to Expo's push service. The relay never sees tokens; push providers never see content. */
export const expoPush: PushFn = async (token, body) => {
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ to: token, title: "PocketDeck", body, sound: "default", priority: "high", data: { kind: "attention" } }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* push is best effort */
  }
};
