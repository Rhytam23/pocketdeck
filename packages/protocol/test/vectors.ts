/** Regression vectors. Other implementations of the protocol must reproduce these exactly. */
const seed = (n: number) => Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + n) & 255);

export const V = {
  bridgeSecret: seed(1),
  phoneSecret: seed(2),
  pairingSecret: seed(3),
  bridgePublicHex: "c8feca81be196cdf2cadeabf13c4903d7632dce4955aa68b6e5d9adef54e2616",
  phonePublicHex: "73e79971c9110029723632a80b707bf4f62c125763346e1e8718d6c0dcc3aa3a",
  joinToken: "tLQh75_LrED5WehT7vcDt2wkJtY8bvpzdtCGiblAXJ0",
  joinTokenHash: "3W6VdFDT4WWLKKEbhSWxCaHa-mcPaUMLY9DSJ3Hl8mk",
  bridgeSendKeyHex: "dfd21e8b91d0dd661a706b1d24553cb1a7127ea68295a0bd4e65e91a90c7de52",
  bridgeRecvKeyHex: "f19930d7879b2d7636028b61ea73fd600273ec7e7965b8d09048261ba22c3380",
  approval: { agent: "claude-code", sessionId: "s1", tool: "Bash", command: "rm -rf build", requestId: "r1" },
  approvalHash: "eb6087f6d16ccb9d274474d3e2d7dbe6ffd38ac12d174c433f1528ab2de1c200",
  canonicalIn: { b: 1, a: [{ z: null, y: "é" }], c: undefined },
  canonicalOut: '{"a":[{"y":"é","z":null}],"b":1}',
};
