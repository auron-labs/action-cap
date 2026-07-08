import { defineManifest } from '@crxjs/vite-plugin'

declare const process: { env: Record<string, string | undefined> }

const TARGET_BROWSER = process.env.ACTIONCAP_BROWSER === 'firefox' ? 'firefox' : 'chrome'

const icons = {
  16: 'icons/icon16.png',
  32: 'icons/icon32.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png',
}

const basePermissions = ['storage', 'tabs', 'scripting', 'webNavigation']

const permissions =
  TARGET_BROWSER === 'firefox'
    ? [...basePermissions, 'webRequest', 'webRequestBlocking']
    : [...basePermissions, 'debugger']

const background =
  TARGET_BROWSER === 'firefox'
    ? {
        scripts: ['src/background/service-worker.ts'],
        type: 'module' as const,
      }
    : {
        service_worker: 'src/background/service-worker.ts',
        type: 'module' as const,
      }

const manifest = defineManifest({
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_extensionName__',
  short_name: '__MSG_extensionShortName__',
  version: '0.1.0',
  description: '__MSG_extensionDescription__',
  icons,
  action: {
    default_title: '__MSG_actionDefaultTitle__',
    default_popup: 'popup.html',
    default_icon: icons,
  },
  background,
  permissions,
  host_permissions: ['<all_urls>'],
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/recorder.ts'],
      run_at: 'document_start',
    },
  ],
  web_accessible_resources: [
    {
      resources: ['results.html'],
      matches: ['<all_urls>'],
    },
  ],
})

if (TARGET_BROWSER === 'firefox') {
  ;(manifest as unknown as { browser_specific_settings: unknown }).browser_specific_settings = {
    gecko: {
      id: 'actioncap@actioncap.dev',
      strict_min_version: '115.0',
    },
  }
}

export default manifest
