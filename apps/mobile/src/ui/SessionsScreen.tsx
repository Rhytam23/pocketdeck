import { FlatList, Pressable, Text, View } from "react-native";
import type { Message } from "@pocketdeck/protocol";
import { liveApprovals, sessionLabel, sortSessions, STATE_TEXT, type AppState } from "../core/state";
import { ApprovalCard } from "./ApprovalCard";
import { Button, c, s } from "./theme";

const dot = { needs_approval: c.warn, error: c.bad, running: c.accent, idle: c.ok, ended: c.dim } as const;
const CONN = { online: "Connected", relay: "Computer offline", connecting: "Connecting…", offline: "No connection" } as const;

export function SessionsScreen({ st, now, onOpen, onSend, onUnpair }: {
  st: AppState; now: number; onOpen: (id: string) => void; onSend: (m: Message) => void; onUnpair: () => void;
}) {
  const approvals = liveApprovals(st, now);
  return (
    <View style={s.screen}>
      <FlatList
        contentContainerStyle={s.pad}
        data={sortSessions(st.sessions)}
        keyExtractor={(x) => x.id}
        ListHeaderComponent={
          <View style={{ marginBottom: 8 }}>
            <Text style={s.h1}>{st.deviceName ?? "PocketDeck"}</Text>
            <Text style={[s.dim, { marginBottom: 12 }]}>{CONN[st.conn]}</Text>
            {approvals.map((a) => <ApprovalCard key={a.requestId} a={a} now={now} onSend={onSend} />)}
          </View>
        }
        ListEmptyComponent={<Text style={s.dim}>No sessions yet. Start Claude Code on your computer.</Text>}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => onOpen(item.id)} style={[s.card, { minHeight: 64 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot[item.state] }} />
              <Text style={[s.text, { flex: 1 }]} numberOfLines={1}>{sessionLabel(item)}</Text>
              <Text style={s.dim}>{STATE_TEXT[item.state]}</Text>
            </View>
            {item.lastTurn ? <Text style={[s.dim, { marginTop: 6 }]} numberOfLines={2}>{item.lastTurn}</Text> : null}
          </Pressable>
        )}
        ListFooterComponent={<Button label="Unpair this computer" color={c.line} onPress={onUnpair} style={{ marginTop: 16 }} />}
      />
    </View>
  );
}
