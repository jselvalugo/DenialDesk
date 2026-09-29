# Bundled fonts

Self-hosted so builds never depend on a network call to Google Fonts (a flaky download broke the
container build) and pages make no third-party font requests (R-7.4.8). Latin subset only.

| File                                                             | Font                            | Source                                     | License                             |
| ---------------------------------------------------------------- | ------------------------------- | ------------------------------------------ | ----------------------------------- |
| `ibm-plex-sans-latin-wght.woff2`                                 | IBM Plex Sans (variable weight) | `@fontsource-variable/ibm-plex-sans` 5.3.0 | SIL OFL 1.1 (`LICENSE-IBMPlex.txt`) |
| `ibm-plex-mono-latin-400.woff2`, `ibm-plex-mono-latin-700.woff2` | IBM Plex Mono                   | `@fontsource/ibm-plex-mono` 5.3.0          | SIL OFL 1.1 (`LICENSE-IBMPlex.txt`) |
