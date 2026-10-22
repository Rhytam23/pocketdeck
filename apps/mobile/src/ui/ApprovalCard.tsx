import { useState } from "react";
import { Text, View } from "react-native";
import { approvalView, buildDecision } from "../core/approval";
import type { ApprovalItem } from "../core/state";
import { authenticateForAllow } from "../platform/auth";
import type { Message } from "@pocketdeck/protocol";
import { Button, c, s } from "./theme";

export function ApprovalCard({ a, now, onSend }: { a: ApprovalItem; now: number; onSend: (m: Message) => void }) {
  const v = approvalView(a, now);
  const [err, setErr] = useState<string>();

  const deny = () => onSend(buildDecision(a, "deny", "none", Date.now()));
  const allow = async () => {
    setErr(undefined);
    try {
      const auth = await authenticateForAllow(`Allow ${a.tool}?`);
      if (auth === "cancelled") return;
      onSend(buildDecision(a, "allow", auth, Date.now()));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <View style={[s.card, { borderColor: c.warn }]}>
      <Text style={s.text}>
        {a.tool} wants to run <Text style={s.dim}>({v.expired ? "expired" : `${v.secondsLeft}s left`})</Text>
      </Text>
      <View style={{ backgroundColor: c.bg, borderRadius: 8, padding: 10, marginVertical: 10 }}>
        <Text selectable style={s.mono}>{a.command}{a.truncated ? " …" : ""}</Text>
      </View>
      {v.allowBlockedReason ? <Text style={[s.dim, { marginBottom: 10 }]}>{v.allowBlockedReason}</Text> : null}
      {err ? <Text style={{ color: c.bad, marginBottom: 10 }}>{err}</Text> : null}
      <View style={s.row}>
        <Button label="Deny" color={c.bad} onPress={deny} disabled={v.expired} style={{ flex: 1 }} />
        <Button label="Allow" color={c.ok} onPress={allow} disabled={!v.allowEnabled} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
