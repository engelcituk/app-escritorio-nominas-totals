import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
const electron = vi.hoisted(() => ({ handle: vi.fn(), app: { isPackaged: true } }));
vi.mock('electron', () => ({ ipcMain: { handle: electron.handle }, app: electron.app }));
import { isTrustedRendererUrl, trustedHandler } from '../../src/main/ipc/trustedSender.js';
import { getRendererUrl } from '../../src/main/window.js';

describe('frontera IPC', () => {
  beforeEach(() => electron.handle.mockClear());
  it('permite rutas hash de la misma página, no otras páginas/orígenes/query', () => {
    const expected = 'file:///D:/app/index.html';
    expect(isTrustedRendererUrl(`${expected}#/acceso`, expected)).toBe(true);
    for (const actual of ['file:///D:/app/other.html', 'https://evil.example', `${expected}?x=1`, 'invalid']) {
      expect(isTrustedRendererUrl(actual, expected)).toBe(false);
    }
  });
  it('rechaza otra ventana y subframes aunque presenten la misma URL', () => {
    const listener = vi.fn();
    const mainFrame = { url: getRendererUrl() };
    const webContents = { mainFrame };
    const window = { isDestroyed: () => false, webContents } as unknown as BrowserWindow;
    trustedHandler(() => window)('test', listener);
    const handler = electron.handle.mock.calls[0]?.[1] as (event: IpcMainInvokeEvent) => void;
    const allowed = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
    handler(allowed);
    expect(listener).toHaveBeenCalledOnce();
    expect(() => handler({ ...allowed, sender: {} } as IpcMainInvokeEvent)).toThrow('Solicitud no autorizada');
    expect(() => handler({ ...allowed, senderFrame: { ...mainFrame } } as IpcMainInvokeEvent)).toThrow('Solicitud no autorizada');
    mainFrame.url = 'https://evil.example';
    expect(() => handler(allowed)).toThrow('Solicitud no autorizada');
    expect(listener).toHaveBeenCalledOnce();
  });
  it('un paquete ignora VITE_DEV_SERVER_URL', () => {
    vi.stubEnv('VITE_DEV_SERVER_URL', 'https://evil.example');
    try { expect(getRendererUrl()).toMatch(/^file:/); } finally { vi.unstubAllEnvs(); }
  });
});
