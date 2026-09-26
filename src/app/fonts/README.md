# Bundled fonts

Self-hosted so builds never depend on a network call to Google Fonts (a flaky download broke the
container build) and pages make no third-party font requests (R-7.4.8). Latin subset only.

| File                                                       | Font                               | Source                                        | License                                     |
| ---------------------------------------------------------- | ---------------------------------- | --------------------------------------------- | ------------------------------------------- |
| `inter-latin-wght.woff2`                                   | Inter (variable weight)            | `@fontsource-variable/inter` 5.3.0            | SIL OFL 1.1 (`LICENSE-Inter.txt`)           |
| `playfair-display-latin-wght.woff2`                        | Playfair Display (variable weight) | `@fontsource-variable/playfair-display` 5.3.0 | SIL OFL 1.1 (`LICENSE-PlayfairDisplay.txt`) |
| `space-mono-latin-400.woff2`, `space-mono-latin-700.woff2` | Space Mono                         | `@fontsource/space-mono` 5.3.0                | SIL OFL 1.1 (`LICENSE-SpaceMono.txt`)       |
