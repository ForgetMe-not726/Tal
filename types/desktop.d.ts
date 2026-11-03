export {};

declare global {
  interface Window {
    desktop?: {
      openLogs: () => Promise<unknown>;
      openWorkspace: () => Promise<unknown>;
      pickLibraryFiles: () => Promise<string[]>;
      pickLibraryFolder: () => Promise<string[]>;
    };
  }
}
