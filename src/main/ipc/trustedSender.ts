import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { getRendererUrl } from '../window.js';

export function isTrustedRendererUrl(actual: string, expected: string): boolean {
  try {
    const received = new URL(actual); const allowed = new URL(expected);
    received.hash = ''; allowed.hash = '';
    return received.href === allowed.href;
  } catch { return false; }
}

export function trustedHandler(windowProvider: () => BrowserWindow | null) {
  return (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const window = windowProvider();
      if (!window || window.isDestroyed() || event.sender !== window.webContents
        || event.senderFrame !== window.webContents.mainFrame
        || !isTrustedRendererUrl(event.senderFrame.url, getRendererUrl())) {
        throw new Error('Solicitud no autorizada.');
      }
      return listener(event, ...args);
    });
  };
}
