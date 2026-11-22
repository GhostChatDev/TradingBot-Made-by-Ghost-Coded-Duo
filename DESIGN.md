# Ghost Desk design

A calm, clear paper trading desk. No 3D. The existing repository's dark terminal is the visual system; no new UI library is introduced.

- Background `#080e12`; surface `#101b21`; border `#293b42`; text `#edf5f3`; muted `#a9bbb9`; accent `#6ee7b7`; success `#6ee7b7`; danger `#ff9494`.
- System sans-serif; 14px body, 20px section titles, 32px hero figures. Tabular figures for prices and balances.
- Spacing: 8, 16, 24, 32px. One 12px radius for cards and buttons.
- Components: responsive header, status banner, summary cards, manually updated quote and signal, ticket and gate, journal, and external-wallet panel.
- A phone uses a single column; larger screens use two columns. All controls have labels and visible focus.
- A deterministic, user-supplied quote is simulated market input, not live data. The desk never sends a trade or accesses a wallet key. The browser stores paper state on this device only.
- Funding means displaying a connected external EVM wallet's address and native-coin balance. No deposit is held, verified or credited by this application, and no transfer or signature is requested. Wallet addresses and networks must be checked in the wallet before receiving crypto.
