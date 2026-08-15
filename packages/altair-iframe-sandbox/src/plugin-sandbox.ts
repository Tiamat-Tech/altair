import type { FrameOptions } from 'altair-graphql-core/build/plugin/v3/frame-worker';
import type { PluginSandboxInitialization } from 'altair-graphql-core/build/plugin/v3/parent-worker';
import {
  PLUGIN_SANDBOX_BOOTSTRAP_READY,
  PLUGIN_SANDBOX_INITIALIZE,
  PLUGIN_SANDBOX_INITIALIZED,
} from 'altair-graphql-core/build/plugin/v3/events';
import {
  injectScript,
  injectStylesheet,
} from 'altair-graphql-core/build/utils/inject';

declare global {
  interface Window {
    __ALTAIR_PLUGIN_PARAMS__?: FrameOptions;
  }
}

const SANDBOX_ORIGIN_WITH_LEGACY_QUERY_INITIALIZATION =
  'https://sandbox.altairgraphql.dev';

const isInitialization = (
  value: unknown
): value is PluginSandboxInitialization => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const { params, scriptUrls, styleUrls } = value as PluginSandboxInitialization;
  return (
    typeof params?.sc === 'string' &&
    typeof params.id === 'string' &&
    (params.instanceType === 'main' || params.instanceType === 'panel') &&
    Array.isArray(scriptUrls) &&
    scriptUrls.every((url) => typeof url === 'string') &&
    Array.isArray(styleUrls) &&
    styleUrls.every((url) => typeof url === 'string')
  );
};

interface LegacyPluginSandboxOptions {
  type: 'scripts';
  scriptUrls: string[];
  styleUrls: string[];
}

const isLegacyPluginSandboxOptions = (
  value: unknown
): value is LegacyPluginSandboxOptions => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const { type, scriptUrls, styleUrls } = value as LegacyPluginSandboxOptions;
  return (
    type === 'scripts' &&
    Array.isArray(scriptUrls) &&
    scriptUrls.every((url) => typeof url === 'string') &&
    Array.isArray(styleUrls) &&
    styleUrls.every((url) => typeof url === 'string')
  );
};

/**
 * @deprecated Query-based sandbox initialization exposes plugin asset URLs.
 * Only the hosted sandbox supports it temporarily for backwards compatibility.
 */
const getDeprecatedQueryInitialization = () => {
  if (
    window.location.origin !==
    SANDBOX_ORIGIN_WITH_LEGACY_QUERY_INITIALIZATION
  ) {
    return;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const legacyOptions = searchParams.get('plugin_sandbox_opts');
  if (!legacyOptions) {
    return;
  }

  let parsedOptions: unknown;
  try {
    parsedOptions = JSON.parse(legacyOptions);
  } catch {
    throw new Error('Invalid deprecated plugin options provided!');
  }

  if (!isLegacyPluginSandboxOptions(parsedOptions)) {
    throw new Error('Invalid deprecated plugin options provided!');
  }

  const params = Object.fromEntries(searchParams) as FrameOptions;
  const initialization: PluginSandboxInitialization = {
    params,
    scriptUrls: parsedOptions.scriptUrls,
    styleUrls: parsedOptions.styleUrls,
  };
  if (!isInitialization(initialization)) {
    throw new Error('Invalid deprecated plugin options provided!');
  }

  // eslint-disable-next-line no-console
  console.warn(
    'Query-based plugin sandbox initialization is deprecated. Update Altair to use postMessage initialization.'
  );
  return initialization;
};

const getMessageInitialization = () =>
  new Promise<PluginSandboxInitialization>((resolve, reject) => {
    const listener = (e: MessageEvent<unknown>) => {
      if (e.source !== window.parent || !e.data || typeof e.data !== 'object') {
        return;
      }

      const message = e.data as { type?: unknown; payload?: unknown };
      if (message.type !== PLUGIN_SANDBOX_INITIALIZE) {
        return;
      }

      if (!isInitialization(message.payload)) {
        window.removeEventListener('message', listener);
        reject(new Error('Invalid plugin sandbox initialization provided!'));
        return;
      }

      if (e.origin !== message.payload.params.sc) {
        window.removeEventListener('message', listener);
        reject(new Error('Invalid plugin sandbox source!'));
        return;
      }

      window.removeEventListener('message', listener);
      resolve(message.payload);
    };
    window.addEventListener('message', listener);
    window.parent.postMessage({ type: PLUGIN_SANDBOX_BOOTSTRAP_READY }, '*');
  });

export const handlePluginSandbox = async () => {
  const initialization =
    getDeprecatedQueryInitialization() ?? (await getMessageInitialization());
  window.__ALTAIR_PLUGIN_PARAMS__ = initialization.params;

  // Remove all styles from the document (plugin styles will be injected later)
  document
    .querySelectorAll('style,link[rel="stylesheet"]')
    .forEach((item) => item.remove());

  // Load plugin scripts and styles
  for (const style of initialization.styleUrls) {
    await injectStylesheet(style);
  }

  for (const script of initialization.scriptUrls) {
    await injectScript(script);
  }

  window.parent.postMessage(
    { type: PLUGIN_SANDBOX_INITIALIZED, frameId: initialization.params.id },
    initialization.params.sc
  );
};
