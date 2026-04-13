# HoTS Replay Uploader

A small open-source desktop app that automatically uploads your [Heroes of the Storm](https://heroesofthestorm.blizzard.com/) replays to [HoTS Record](https://hots.autrpop.com) after every game.

<img width="532" height="632" alt="App screenshot" src="https://github.com/user-attachments/assets/f72fd9d8-58a9-43a9-92b3-87751c72d368" />

## How it works

Enter your Battletag, confirm your replay folder (auto-detected on macOS and Windows), and minimize to tray. From there it runs automatically. When it detects that Heroes of the Storm has closed, it scans your replay folder, uploads any new `.StormReplay` files over HTTPS, and records what was sent so duplicates are never uploaded twice.

## Privacy

The source code is fully open and every release is built by the public GitHub Actions workflow in this repo. The app only reads `.StormReplay` files and your Battletag. No passwords or Blizzard credentials are ever collected. Settings and upload history stay on your machine.

## Download

Get the latest installer from the [Releases](https://github.com/dmackerman/hots-record-uploader/releases) page (`.dmg` for macOS, `.exe` for Windows).

## Development

```bash
npm install
npm start      # run in development mode
npm run make   # build distributable packages
```
