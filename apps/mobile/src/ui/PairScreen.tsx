import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Button, c, s } from "./theme";

export function PairScreen({ onCode }: { onCode: (uri: string) => string | undefined }) {
  const [perm, ask] = useCameraPermissions();
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string>();
  const busy = useRef(false);

  const submit = (uri: string) => {
    if (busy.current) return;
    busy.current = true;
    const err = onCode(uri.trim());
    if (err) {
      setError(err);
      setTimeout(() => (busy.current = false), 1500);
    }
  };

  return (
    <View style={[s.screen, s.pad]}>
      <Text style={s.h1}>Pair with your computer</Text>
      <Text style={[s.dim, { marginVertical: 8 }]}>Run `pocketdeck pair --relay …` on your computer and scan the QR code.</Text>
      {perm?.granted ? (
        <View style={{ height: 280, borderRadius: 12, overflow: "hidden", marginVertical: 12 }}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => submit(data)}
          />
        </View>
      ) : (
        <Button label="Allow camera to scan" onPress={() => void ask()} style={{ marginVertical: 12 }} />
      )}
      {error ? <Text style={{ color: c.bad, marginBottom: 8 }}>{error}</Text> : null}
      <Text style={s.dim}>No camera? Paste the manual code:</Text>
      <TextInput
        value={manual}
        onChangeText={setManual}
        placeholder="pocketdeck://pair?d=…"
        placeholderTextColor={c.dim}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ color: c.text, borderColor: c.line, borderWidth: 1, borderRadius: 10, minHeight: 48, paddingHorizontal: 12, marginVertical: 8 }}
      />
      <Button label="Pair" onPress={() => submit(manual)} disabled={!manual} />
    </View>
  );
}
