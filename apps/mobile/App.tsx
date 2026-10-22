import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { generateKeyPair, decodePairingUri } from "@pocketdeck/protocol/crypto";
import type { Message } from "@pocketdeck/protocol";
import { PhoneConnection } from "./src/core/connection";
import { initialState, reducer } from "./src/core/state";
import { clearPairing, loadSaved, savePairing, savePersisted, type Saved } from "./src/platform/storage";
import { registerForPush } from "./src/platform/push";
import { PairScreen } from "./src/ui/PairScreen";
import { SessionScreen } from "./src/ui/SessionScreen";
import { SessionsScreen } from "./src/ui/SessionsScreen";
import { c } from "./src/ui/theme";

export default function App() {
  const [saved, setSaved] = useState<Saved | null | undefined>(undefined);
  const [st, dispatch] = useReducer(reducer, initialState);
  const [open, setOpen] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const conn = useRef<PhoneConnection | undefined>(undefined);
  const pushToken = useRef<string | undefined>(undefined);

  useEffect(() => {
    void loadSaved().then(setSaved);
    void registerForPush().then((t) => (pushToken.current = t));
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!saved) return;
    const pc = new PhoneConnection({
      payload: saved.payload,
      keys: saved.keys,
      persisted: saved.persisted,
      deviceName: "Phone",
      pushToken: () => pushToken.current,
      createSocket: (url) => new WebSocket(url) as never,
      onMessage: (m) => dispatch({ type: "msg", m }),
      onStatus: (status) => dispatch({ type: "conn", status }),
      onPersist: savePersisted,
    });
    conn.current = pc;
    pc.start();
    return () => {
      pc.stop();
      conn.current = undefined;
    };
  }, [saved]);

  // Send our push token once registration finishes after the first hello.
  useEffect(() => {
    const t = setTimeout(() => conn.current?.hello(), 3000);
    return () => clearTimeout(t);
  }, [saved]);

  const send = useCallback((m: Message) => conn.current?.send(m), []);

  const onCode = useCallback((uri: string): string | undefined => {
    try {
      const payload = decodePairingUri(uri);
      const keys = generateKeyPair();
      void savePairing(payload, keys).then(() => setSaved({ payload, keys, persisted: { handshakeDone: false } }));
      return undefined;
    } catch {
      return "That is not a PocketDeck pairing code.";
    }
  }, []);

  const unpair = useCallback(() => {
    void clearPairing().then(() => {
      setSaved(null);
      setOpen(undefined);
    });
  }, []);

  let body = null;
  if (saved === null) body = <PairScreen onCode={onCode} />;
  else if (saved && open) body = <SessionScreen id={open} st={st} now={now} onBack={() => setOpen(undefined)} onSend={send} />;
  else if (saved) body = <SessionsScreen st={st} now={now} onOpen={setOpen} onSend={send} onUnpair={unpair} />;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <StatusBar style="light" />
        {body}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
