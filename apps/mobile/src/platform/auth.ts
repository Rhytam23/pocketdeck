import * as LocalAuthentication from "expo-local-authentication";
import type { AuthLevel } from "../core/approval";

export type AuthResult = AuthLevel | "cancelled";

/** Asks for biometrics, falling back to the device passcode. Returns what actually protected the action. */
export async function authenticateForAllow(promptMessage: string): Promise<AuthResult> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) return "none";
  const r = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: "Cancel", disableDeviceFallback: false });
  if (!r.success) return "cancelled";
  return level === LocalAuthentication.SecurityLevel.SECRET ? "screenlock" : "biometric";
}
