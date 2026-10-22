import { Pressable, StyleSheet, Text, type ViewStyle } from "react-native";

export const c = {
  bg: "#0d1117", card: "#161b22", line: "#30363d", text: "#e6edf3", dim: "#8b949e",
  accent: "#58a6ff", ok: "#3fb950", bad: "#f85149", warn: "#d29922",
};

/** Every tap target is at least 48dp tall so the app works one-handed at 375px wide. */
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  pad: { padding: 16 },
  h1: { color: c.text, fontSize: 22, fontWeight: "700" },
  text: { color: c.text, fontSize: 16 },
  dim: { color: c.dim, fontSize: 14 },
  card: { backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  mono: { color: c.text, fontFamily: "Courier", fontSize: 13 },
  btn: { minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  row: { flexDirection: "row", gap: 12 },
});

export function Button({ label, onPress, color = c.accent, disabled, style }: { label: string; onPress: () => void; color?: string; disabled?: boolean; style?: ViewStyle }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[s.btn, { backgroundColor: disabled ? c.line : color }, style]}
    >
      <Text style={s.btnText}>{label}</Text>
    </Pressable>
  );
}
