const path = require('path');

module.exports = {
  packagerConfig: {
    name: 'HoTS Replay Uploader',
    icon: './assets/icon',
    asar: true,
    // macOS code signing — only active when APPLE_IDENTITY is set (i.e. in CI)
    ...(process.env.APPLE_IDENTITY && {
      osxSign: {
        identity: process.env.APPLE_IDENTITY, // e.g. "Developer ID Application: Dave Mackerman (TEAMID)"
        optionsForFile: () => ({ entitlements: './entitlements.plist' }),
      },
      osxNotarize: {
        tool: 'notarytool',
        appleId: process.env.APPLE_ID,               // your Apple ID email
        appleIdPassword: process.env.APPLE_APP_PASSWORD, // app-specific password from appleid.apple.com
        teamId: process.env.APPLE_TEAM_ID,
      },
    }),
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'hots-replay-uploader',
        authors: 'dmackerman',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
      },
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: { owner: 'dmackerman', name: 'hots-record' },
        prerelease: false,
        draft: true, // creates a draft — review on GitHub before clicking Publish
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              html: './src/renderer/index.html',
              js: './src/renderer/app.ts',
              name: 'main_window',
              preload: {
                js: './src/preload.ts',
              },
            },
          ],
        },
      },
    },
  ],
};
