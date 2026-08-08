import { VitePlugin } from "@electron-forge/plugin-vite";

const config = {
  packagerConfig: {
    asar: true,
  },
  makers: [],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/main.ts",
          config: "vite.main.config.mts",
        },
        {
          entry: "src/preload/preload.ts",
          config: "vite.preload.config.mts",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),
  ],
};

export default config;
