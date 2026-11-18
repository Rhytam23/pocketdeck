<!-- Improved compatibility of back to top link: See: https://github.com/othneildrew/Best-README-Template/pull/73 -->
<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![License][license-shield]][license-url]


<!-- PROJECT LOGO -->
<br />
<div align="center">
<h3 align="center">PocketDeck</h3>

  <p align="center">
    One phone app to watch, steer and approve every AI coding agent you run: any agent, any machine, phone first.
    <br />
    <a href="https://github.com/Rhytam23/pocketdeck"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/Rhytam23/pocketdeck/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/Rhytam23/pocketdeck/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>


<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>


<!-- ABOUT THE PROJECT -->
## About The Project

**One phone app to watch, steer and approve every AI coding agent you run: any agent, any machine, phone first.**

> Status: **Stage 1 (Events MVP) implemented, not yet used by real people.** Protocol, relay, desktop bridge (Claude Code) and the Expo phone app exist with automated tests. Anything needing a real phone (camera, biometrics, push delivery) is untested. Peek and Cloud runner are not started. See [Getting started](docs/GETTING_STARTED.md) and [docs/SECURITY.md](docs/SECURITY.md).

### The problem


AI coding agents (Claude Code, Codex, Gemini CLI, OpenCode, Cursor and others) run for a long time and keep stopping to ask for approval. Every vendor ships its own remote feature, and open-source tools each cover one slice: some show structured sessions, some stream the desktop, some run agents in the cloud. Nothing combines them in a phone-first app.

### The idea


Three layers; the phone always picks the cheapest one that answers your question.

1. **Events (default).** Structured sessions from any agent: steps, diffs, test results, approve or deny, send the next instruction. Tiny bandwidth, works great on a phone.
2. **Peek (on demand).** Stream just the window or region you need (browser preview, failing test, IDE panel) over peer-to-peer WebRTC.
3. **Cloud runner (optional).** Start a task in a sandbox so it keeps going when your computer is off.

Phone-first features: Lock Screen approvals with biometrics, push notifications, voice tasks, scheduled and queued runs, swipe-to-review diffs, one "needs you" inbox across all agents and machines.

### Architecture (planned)


```
Phone app  <--E2E encrypted-->  Relay (self-hostable)  <--E2E encrypted-->  Desktop bridge
                                                                              |- agent adapters (hooks / SDK / PTY)
                                                                              |- peek (screen capture, WebRTC)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/PRIOR_ART.md](docs/PRIOR_ART.md).

### Repo layout


| Path | Purpose |
|---|---|
| `apps/desktop-bridge` | Runs on your computer; adapts agents and talks to the relay |
| `apps/relay` | Small stateless forwarder; never sees content keys |
| `apps/mobile` | The phone app |
| `packages/protocol` | Shared message schema used by all three |
| `docs/` | Vision, architecture, roadmap, build prompt |

### Principles


- Open source (MIT). No telemetry, no account required.
- End-to-end encryption; the relay is untrusted and self-hostable.
- Every risky action needs an explicit tap. Never block the agent if the phone is unreachable.
- Phone first: if it is awkward on a phone, it is not done.

<p align="right">(<a href="#readme-top">back to top</a>)</p>


### Built With

* [![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
* [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
* [![Expo](https://img.shields.io/badge/Expo-000020?style=for-the-badge&logo=expo&logoColor=white)](https://expo.dev/)
* [![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)

<p align="right">(<a href="#readme-top">back to top</a>)</p>


<!-- ROADMAP -->
## Roadmap

See the [open issues](https://github.com/Rhytam23/pocketdeck/issues) for a full list of proposed features (and known issues).

<p align="right">(<a href="#readme-top">back to top</a>)</p>


<!-- CONTRIBUTING -->
## Contributing


Open an issue to discuss before large changes. See [docs/BUILD_PROMPT.md](docs/BUILD_PROMPT.md) for the current build brief.

<p align="right">(<a href="#readme-top">back to top</a>)</p>


<!-- LICENSE -->
## License


MIT, see [LICENSE](LICENSE).

<p align="right">(<a href="#readme-top">back to top</a>)</p>


<!-- CONTACT -->
## Contact

Rhytam Biswas - [@Rhytam23](https://github.com/Rhytam23)

Project Link: [https://github.com/Rhytam23/pocketdeck](https://github.com/Rhytam23/pocketdeck)

<p align="right">(<a href="#readme-top">back to top</a>)</p>


<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/Rhytam23/pocketdeck.svg?style=for-the-badge
[contributors-url]: https://github.com/Rhytam23/pocketdeck/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/Rhytam23/pocketdeck.svg?style=for-the-badge
[forks-url]: https://github.com/Rhytam23/pocketdeck/network/members
[stars-shield]: https://img.shields.io/github/stars/Rhytam23/pocketdeck.svg?style=for-the-badge
[stars-url]: https://github.com/Rhytam23/pocketdeck/stargazers
[issues-shield]: https://img.shields.io/github/issues/Rhytam23/pocketdeck.svg?style=for-the-badge
[issues-url]: https://github.com/Rhytam23/pocketdeck/issues
[license-shield]: https://img.shields.io/github/license/Rhytam23/pocketdeck.svg?style=for-the-badge
[license-url]: https://github.com/Rhytam23/pocketdeck/blob/main/LICENSE
