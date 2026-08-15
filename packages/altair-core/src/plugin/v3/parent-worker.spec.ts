import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLUGIN_SANDBOX_BOOTSTRAP_READY,
  PLUGIN_SANDBOX_INITIALIZE,
  PLUGIN_SANDBOX_INITIALIZED,
} from './events';
import { PluginParentWorker } from './parent-worker';

describe('PluginParentWorker', () => {
  let worker: PluginParentWorker | undefined;

  beforeEach(() => {
    Object.defineProperty(HTMLIFrameElement.prototype, 'sandbox', {
      configurable: true,
      value: { add: vi.fn() },
    });
  });

  afterEach(() => {
    worker?.destroy();
    worker = undefined;
    vi.restoreAllMocks();
    delete (HTMLIFrameElement.prototype as { sandbox?: unknown }).sandbox;
  });

  it('initializes script sandboxes with postMessage instead of URL parameters', async () => {
    worker = new PluginParentWorker({
      id: 'plugin-1',
      type: 'scripts',
      sandboxUrl: 'https://sandbox.example/index.html',
      scriptUrls: ['https://plugin.example/index.js'],
      styleUrls: ['https://plugin.example/index.css'],
    });
    const iframe = worker.getIframe();
    const sandboxWindow = iframe.contentWindow;
    expect(sandboxWindow).not.toBeNull();
    if (!sandboxWindow) {
      throw new Error('Expected iframe content window');
    }

    const postMessage = vi.spyOn(sandboxWindow, 'postMessage');
    expect(iframe.src).toBe(
      'https://sandbox.example/index.html?sandbox_type=plugin'
    );
    expect(iframe.src).not.toContain('scriptUrls');
    expect(iframe.src).not.toContain('styleUrls');

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'null',
        source: window,
        data: { type: PLUGIN_SANDBOX_BOOTSTRAP_READY },
      })
    );
    expect(postMessage).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'null',
        source: sandboxWindow,
        data: { type: PLUGIN_SANDBOX_BOOTSTRAP_READY },
      })
    );

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: PLUGIN_SANDBOX_INITIALIZE,
        payload: {
          params: {
            sc: window.location.origin,
            id: 'plugin-1',
            instanceType: 'main',
          },
          scriptUrls: ['https://plugin.example/index.js'],
          styleUrls: ['https://plugin.example/index.css'],
        },
      },
      '*'
    );

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'null',
        source: sandboxWindow,
        data: { type: PLUGIN_SANDBOX_INITIALIZED, frameId: 'plugin-1' },
      })
    );
    worker.send('plugin-engine::ready');
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        { type: 'plugin-engine::ready', payload: undefined },
        '*'
      );
    });
  });
});
