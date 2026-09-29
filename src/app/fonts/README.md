# Bundled fonts

Self-hosted so builds never depend on a network call to Google Fonts (a flaky download broke the
container build) and pages make no third-party font requests (R-7.4.8). Latin subset only.

| File                                                             | Font                            | Source                                     | License                             |
| ---------------------------------------------------------------- | ------------------------------- | ------------------------------------------ | ----------------------------------- |
| `ibm-plex-sans-latin-wght.woff2`                                 | IBM Plex Sans (variable weight) | `@fontsource-variable/ibm-plex-sans` 5.3.0 | SIL OFL 1.1 (`LICENSE-IBMPlex.txt`) |
| `ibm-plex-mono-latin-400.woff2`, `ibm-plex-mono-latin-700.woff2` | IBM Plex Mono                   | `@fontsource/ibm-plex-mono` 5.3.0          | SIL OFL 1.1 (`LICENSE-IBMPlex.txt`) |

SHA-256 (verify with `sha256sum src/app/fonts/*.woff2`):

```
08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7  ibm-plex-mono-latin-400.woff2
4f84d86cfd060f4ded334358ff8a4c81d4db2ed5addd568359d693f44a87765a  ibm-plex-mono-latin-700.woff2
e2291e842cf5af167122a22881a740c7f2dda7716f1e8cd76680264f4a859470  ibm-plex-sans-latin-wght.woff2
```
