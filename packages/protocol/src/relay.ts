import { z } from "zod";

/** Plaintext control frames spoken between a client and the relay. Everything else is opaque binary. */
export const MAX_FRAME_BYTES = 256 * 1024;

export const RoomId = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
export const JoinToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const ClientControl = z.object({
  t: z.literal("join"),
  room: RoomId,
  role: z.enum(["pc", "phone"]),
  /** Derived from the pairing secret; the relay stores only its hash. Cannot decrypt content. */
  token: JoinToken,
  /** Gate for using the relay at all. Optional when the relay is run with open access explicitly. */
  accessKey: z.string().max(200).optional(),
});
export type ClientControl = z.infer<typeof ClientControl>;

export type RelayErrorCode =
  | "unconfigured"
  | "access_denied"
  | "bad_join"
  | "bad_token"
  | "role_taken"
  | "frame_too_large"
  | "rate_limited"
  | "protocol";

export type ServerControl =
  | { t: "joined"; peer: boolean }
  | { t: "peer"; online: boolean }
  | { t: "error"; code: RelayErrorCode };
