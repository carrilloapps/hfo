export type ThemeName = 'dark' | 'light' | 'dracula' | 'solarized-dark' | 'solarized-light' | 'nord' | 'monokai';

export interface Theme {
  name: ThemeName;
  label: string;
  isDark: boolean;        // informs consumers whether to default to white or black text
  primary: string;
  accent: string;
  text: string;
  muted: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  bgActive: string;       // background for selected tab / highlighted row
  bgActiveFg: string;     // guaranteed-contrast foreground to pair with bgActive
  border: string;         // default border color for panels
}

const DARK: Theme = {
  name: 'dark',
  label: 'Dark (default)',
  isDark: true,
  primary: 'cyan',
  accent: 'cyanBright',
  text: 'white',
  muted: 'gray',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  info: 'blue',
  bgActive: 'cyan',
  bgActiveFg: 'black',
  border: 'gray',
};

const LIGHT: Theme = {
  name: 'light',
  label: 'Light',
  isDark: false,
  primary: 'blue',
  accent: 'magenta',
  text: 'black',
  muted: 'gray',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  info: 'blue',
  bgActive: 'black',
  bgActiveFg: 'white',
  border: 'blackBright',
};

const DRACULA: Theme = {
  name: 'dracula',
  label: 'Dracula',
  isDark: true,
  primary: 'magentaBright',
  accent: 'magenta',
  text: 'white',
  muted: 'gray',
  success: 'greenBright',
  warning: 'yellowBright',
  danger: 'redBright',
  info: 'cyanBright',
  bgActive: 'magenta',
  bgActiveFg: 'white',
  border: 'blackBright',
};

const SOLARIZED_DARK: Theme = {
  name: 'solarized-dark',
  label: 'Solarized Dark',
  isDark: true,
  primary: 'yellow',
  accent: 'cyan',
  text: 'white',
  muted: 'gray',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  info: 'blue',
  bgActive: 'yellow',
  bgActiveFg: 'black',
  border: 'blackBright',
};

const SOLARIZED_LIGHT: Theme = {
  name: 'solarized-light',
  label: 'Solarized Light',
  isDark: false,
  primary: 'blue',
  accent: 'yellow',
  text: 'black',
  muted: 'gray',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  info: 'blue',
  bgActive: 'blue',
  bgActiveFg: 'white',
  border: 'blackBright',
};

const NORD: Theme = {
  name: 'nord',
  label: 'Nord',
  isDark: true,
  primary: 'cyanBright',
  accent: 'blueBright',
  text: 'white',
  muted: 'gray',
  success: 'greenBright',
  warning: 'yellowBright',
  danger: 'redBright',
  info: 'blueBright',
  bgActive: 'blue',
  bgActiveFg: 'white',
  border: 'blackBright',
};

const MONOKAI: Theme = {
  name: 'monokai',
  label: 'Monokai',
  isDark: true,
  primary: 'magentaBright',
  accent: 'greenBright',
  text: 'white',
  muted: 'gray',
  success: 'greenBright',
  warning: 'yellowBright',
  danger: 'redBright',
  info: 'cyanBright',
  bgActive: 'magenta',
  bgActiveFg: 'white',
  border: 'blackBright',
};

export const THEMES: Record<ThemeName, Theme> = {
  dark: DARK,
  light: LIGHT,
  dracula: DRACULA,
  'solarized-dark': SOLARIZED_DARK,
  'solarized-light': SOLARIZED_LIGHT,
  nord: NORD,
  monokai: MONOKAI,
};

export const THEME_LIST: ThemeName[] = [
  'dark',
  'light',
  'dracula',
  'solarized-dark',
  'solarized-light',
  'nord',
  'monokai',
];

export function getTheme(name: ThemeName): Theme {
  return THEMES[name] ?? DARK;
}
