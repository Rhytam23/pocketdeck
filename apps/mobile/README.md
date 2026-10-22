# @pocketdeck/mobile

Expo (React Native, TypeScript) phone app.

```
npm install                       # from the repo root
npm run start -w @pocketdeck/mobile   # then open in Expo Go / a dev build on a real phone
```

Expo Go is enough for pairing, sessions, approvals and biometrics. Push tokens need a dev build plus an EAS project id in `app.json` (`expo.extra.eas.projectId`); without one the app simply runs without push.

## Layout

- `src/core`: pure logic with tests (state reducer, approval rules, encrypted relay connection). No React Native imports.
- `src/platform`: thin wrappers over Expo modules (secure storage, biometrics, push, crypto polyfill).
- `src/ui`: screens. Every tap target is at least 48dp; single column; designed for 375px width.

## Rules enforced here

- Allow runs `authenticateAsync` (biometrics, falling back to the device passcode) immediately before sending. No screen lock enrolled means Allow is refused.
- Truncated commands show only Deny.
- A decision echoes the request's hash; the bridge ignores anything that does not match a live request.

## Not done yet

Voice input, diff swipe review, queued tasks and Lock Screen quick actions are Stage 2. A push carries no content (the relay and push provider are untrusted), so tapping it opens the app, which fetches the pending approval over the encrypted channel.
