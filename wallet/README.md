# Anvil Wallet

**Desktop cryptocurrency wallet for the Anvil Protocol**

## Download

**Windows**: [Anvil Wallet 1.0.0.exe](release/Anvil%20Wallet%201.0.0.exe) (90 MB, portable)

## Quick Start

### Option 1: Run the executable (easiest)

1. Download `Anvil Wallet 1.0.0.exe` from the `release/` folder
2. Double-click to run (no installation needed)
3. Connect to a node (default: `http://localhost:4001`)

### Option 2: Development mode

```bash
cd wallet
npm install
npm run dev
```

Open http://localhost:5173

### Option 3: Build from source

```bash
cd wallet
npm install
npm run build:exe    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

Output: `wallet/release/`

---

## Features

| Feature | Status |
|---------|--------|
| **Create Wallet** | ✅ Generate new keypair |
| **Restore Wallet** | ✅ Import from backup JSON |
| **Backup Keys** | ✅ Download encrypted backup |
| **Send ANVIL** | ✅ Sign transactions locally |
| **Receive ANVIL** | ✅ Copy address to clipboard |
| **Balance Tracking** | ✅ Real-time updates |
| **Multi-Node** | ✅ Connect to any node |
| **Network Status** | ✅ View epoch, peers, chain |

---

## Security

- **Keys stay local** — Never transmitted, stored in browser/app
- **No server required** — Works completely offline after loading
- **Open source** — Audit the code yourself
- **160-bit addresses** — Same security as Ethereum

### Backup Warning

⚠️ **BACKUP YOUR KEYS!**

If you:
- Clear browser data
- Reinstall the app
- Lose your device

...your wallet will be **permanently lost** without a backup.

Click **"💾 Backup Keys"** to download your backup file.

---

## Connecting to Nodes

Default: `http://localhost:4001`

To connect to other nodes:
1. Enter the node URL in the text field
2. Click the refresh button
3. Status dot turns green when connected

---

## Building the Executable

```bash
npm run build:exe
```

This creates:
- `release/Anvil Wallet 1.0.0.exe` (Windows portable)
- `release/win-unpacked/` (Windows folder)

For other platforms:
```bash
npm run build:mac    # Creates .dmg
npm run build:linux  # Creates .AppImage
```

---

## Tech Stack

- React 19
- Vite 7
- Electron 39
- Web Crypto API (ECDSA P-256)

---

## Folder Structure

```
wallet/
├── src/
│   ├── App.jsx        # Main UI
│   ├── api.js         # Node client
│   ├── crypto.js      # Key management
│   ├── index.css      # Styles
│   └── main.jsx       # Entry
├── electron.cjs       # Desktop wrapper
├── release/           # Built executables
└── package.json
```
