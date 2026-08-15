import { EvaluatorWorker, EventData } from '../../evaluator/worker';
import { urlWithParams } from '../../utils/url';
import { FrameOptions, InstanceType, instanceTypes } from './frame-worker';
import {
  PLUGIN_SANDBOX_BOOTSTRAP_READY,
  PLUGIN_SANDBOX_INITIALIZE,
  PLUGIN_SANDBOX_INITIALIZED,
} from './events';

interface BasePluginParentWorkerOptions {
  id: string;
  disableAppend?: boolean;
  instanceType?: InstanceType;
  additionalParams?: Record<string, string>;
  additionalSandboxAttributes?: string[];
  width?: number;
}
interface PluginParentWorkerOptionsWithScripts
  extends BasePluginParentWorkerOptions {
  type: 'scripts';
  sandboxUrl: string;
  scriptUrls: string[];
  styleUrls: string[];
}

interface PluginParentWorkerOptionsWithUrl extends BasePluginParentWorkerOptions {
  type: 'url';
  pluginEntrypointUrl: string;
}
export type PluginParentWorkerOptions =
  | PluginParentWorkerOptionsWithScripts
  | PluginParentWorkerOptionsWithUrl;

export interface PluginSandboxInitialization {
  params: FrameOptions;
  scriptUrls: string[];
  styleUrls: string[];
}

export class PluginParentWorker extends EvaluatorWorker {
  private messageListeners: Array<(e: MessageEvent<any>) => void> = [];
  private iframe: HTMLIFrameElement;
  private frameReadyPromise: Promise<void>;

  constructor(private opts: PluginParentWorkerOptions) {
    super();
    this.iframe = this.createIframe();
    if (this.opts.type === 'scripts') {
      this.frameReadyPromise = this.initializeScriptSandbox(this.opts);
    } else {
      this.frameReadyPromise = new Promise<void>((resolve) => {
        this.iframe.addEventListener('load', () => {
          resolve();
        });
      });
    }

    if (!this.opts.disableAppend) {
      document.body.appendChild(this.iframe);
    }
  }

  private createIframe() {
    const iframe = document.createElement('iframe');
    iframe.id = this.opts.id;
    if (this.opts.instanceType === instanceTypes.PANEL) {
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      iframe.style.display = 'block'; // fixes issue with vertical scrollbar appearing https://stackoverflow.com/a/9131632/3929126
      if ('width' in this.opts && this.opts.width) {
        iframe.style.minWidth = `${this.opts.width}px`;
      }
    } else {
      iframe.style.display = 'none';
    }

    const params: FrameOptions = {
      ...this.opts.additionalParams,
      sc: window.location.origin,
      id: this.opts.id,
      instanceType: this.getInstanceType(),
    };

    // NOTE: Don't add allow-same-origin to the sandbox attribute!
    iframe.sandbox.add('allow-scripts');
    if (this.opts.additionalSandboxAttributes) {
      this.opts.additionalSandboxAttributes.forEach((attr) => {
        iframe.sandbox.add(attr);
      });
    }
    iframe.referrerPolicy = 'no-referrer';

    if (this.opts.type === 'scripts') {
      iframe.src = urlWithParams(this.opts.sandboxUrl, {
        sandbox_type: 'plugin',
      });
    } else if (this.opts.type === 'url') {
      const url = urlWithParams(this.opts.pluginEntrypointUrl, params);
      iframe.src = url;
    }

    return iframe;
  }

  private initializeScriptSandbox(
    opts: PluginParentWorkerOptionsWithScripts
  ) {
    return new Promise<void>((resolve) => {
      const listener = (e: MessageEvent<any>) => {
        if (e.origin !== 'null' || e.source !== this.iframe.contentWindow) {
          return;
        }

        if (e.data?.type === PLUGIN_SANDBOX_BOOTSTRAP_READY) {
          const params: FrameOptions = {
            ...opts.additionalParams,
            sc: window.location.origin,
            id: opts.id,
            instanceType: this.getInstanceType(),
          };
          const initialization: PluginSandboxInitialization = {
            params,
            scriptUrls: opts.scriptUrls,
            styleUrls: opts.styleUrls,
          };
          this.iframe.contentWindow?.postMessage(
            { type: PLUGIN_SANDBOX_INITIALIZE, payload: initialization },
            '*'
          );
          return;
        }

        if (
          e.data?.type === PLUGIN_SANDBOX_INITIALIZED &&
          e.data.frameId === opts.id
        ) {
          window.removeEventListener('message', listener);
          resolve();
        }
      };
      window.addEventListener('message', listener, false);
      this.messageListeners.push(listener);
    });
  }

  private async frameReady() {
    await this.frameReadyPromise;
  }

  getIframe() {
    return this.iframe;
  }

  getInstanceType() {
    return this.opts.instanceType ?? instanceTypes.MAIN;
  }

  onMessage<T extends string, P = unknown>(
    handler: (e: EventData<T, P>) => void
  ): void {
    const listener = (e: MessageEvent<any>) => {
      if (e.origin !== 'null' || e.source !== this.iframe.contentWindow) {
        return;
      }
      if (e.data.frameId !== this.opts.id) {
        // eslint-disable-next-line no-console
        console.error('Invalid frameId in data', e.data.frameId, this.opts.id);
        return;
      }
      handler(e.data);
    };
    window.addEventListener('message', listener, false);
    this.messageListeners.push(listener);
  }
  send<T extends string>(type: T, payload?: unknown): void {
    this.frameReady().then(() => {
      this.iframe.contentWindow?.postMessage(
        { type, payload },
        // https://web.dev/articles/sandboxed-iframes#safely_sandboxing_eval
        // Note that we're sending the message to "*", rather than some specific
        // origin. Sandboxed iframes which lack the 'allow-same-origin' header
        // don't have an origin which you can target: you'll have to send to any
        // origin, which might alow some esoteric attacks. Validate your output!
        '*'
      );
    });
  }
  onError(handler: (err: unknown) => void): void {
    this.iframe.addEventListener('error', handler);
  }
  destroy(): void {
    // cleanup resources
    this.messageListeners.forEach((listener) => {
      window.removeEventListener('message', listener);
    });
    this.iframe.remove();
  }
}
