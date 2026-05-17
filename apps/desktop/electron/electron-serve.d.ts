declare module "electron-serve" {
  import { BrowserWindow } from "electron";
  function serve(options: { directory: string }): (window: BrowserWindow) => Promise<void>;
  export = serve;
}
