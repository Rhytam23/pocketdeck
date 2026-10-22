import { useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { msg, type Message } from "@pocketdeck/protocol";
import { liveApprovals, sessionLabel, STATE_TEXT, type AppState, type EventItem } from "../core/state";
import { ApprovalCard } from "./ApprovalCard";
import { Button, c, s } from "./theme";

function Step({ e }: { e: EventItem }) {
  const [open, setOpen] = useState(false);
  const label = e.summary ?? e.text ?? e.kind;
  return (
    <View style={[s.card, { padding: 10 }]}>
      <Text style={s.dim}>{e.kind}</Text>
      <Text style={s.text} numberOfLines={open ? undefined : 3} onPress={() => setOpen(!open)}>{label}</Text>
      {e.diff ? (
        <View style={{ marginTop: 8 }}>
          {e.diff.split("\n").slice(0, open ? 400 : 12).map((l, i) => (
            <Text key={i} style={[s.mono, { color: l.startsWith("+") ? c.ok : l.startsWith("-") ? c.bad : c.dim }]}>{l}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function SessionScreen({ id, st, now, onBack, onSend }: {
  id: string; st: AppState; now: number; onBack: () => void; onSend: (m: Message) => void;
}) {
  const session = st.sessions.find((x) => x.id === id);
  const events = [...(st.events[id] ?? [])].reverse();
  const approvals = liveApprovals(st, now).filter((a) => a.sessionId === id);
  const [text, setText] = useState("");
  const busy = session?.state === "running" || session?.state === "needs_approval";

  const send = () => {
    if (!text.trim()) return;
    onSend(msg("instruction", { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, sessionId: id, text: text.trim() }));
    setText("");
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <FlatList
        contentContainerStyle={s.pad}
        data={events}
        keyExtractor={(e, i) => `${e.ts}-${i}`}
        ListHeaderComponent={
          <View>
            <Button label="‹ Sessions" color={c.line} onPress={onBack} style={{ alignSelf: "flex-start", marginBottom: 12 }} />
            <Text style={s.h1}>{session ? sessionLabel(session) : "Session"}</Text>
            <Text style={[s.dim, { marginBottom: 12 }]}>{session ? STATE_TEXT[session.state] : ""}</Text>
            {approvals.map((a) => <ApprovalCard key={a.requestId} a={a} now={now} onSend={onSend} />)}
            {session?.lastTurn ? (
              <View style={s.card}>
                <Text style={s.dim}>Last turn</Text>
                <Text selectable style={s.text}>{session.lastTurn}</Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <Step e={item} />}
      />
      <View style={[s.pad, { borderTopColor: c.line, borderTopWidth: 1, gap: 8 }]}>
        {st.notice ? <Text style={{ color: c.warn }}>{st.notice}</Text> : null}
        <TextInput
          value={text}
          onChangeText={setText}
          editable={!busy}
          multiline
          placeholder={busy ? "Session is working…" : "Next instruction"}
          placeholderTextColor={c.dim}
          style={{ color: c.text, borderColor: c.line, borderWidth: 1, borderRadius: 10, minHeight: 48, maxHeight: 120, paddingHorizontal: 12, paddingVertical: 10 }}
        />
        <Button label="Send" onPress={send} disabled={busy || !text.trim()} />
      </View>
    </KeyboardAvoidingView>
  );
}
