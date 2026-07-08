export const TARGET_BROWSER = typeof __BROWSER_TARGET__ !== 'undefined' ? __BROWSER_TARGET__ : 'chrome'
export const IS_FIREFOX = TARGET_BROWSER === 'firefox'
export const IS_CHROME = TARGET_BROWSER === 'chrome'
