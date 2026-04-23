import React from 'react';
import { Box, Text } from 'ink';
import { icon } from '../ui/icons.js';
import { t } from '../ui/i18n.js';

export default function HelpTab() {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">{t('help.title')}</Text>
        <Text color="gray"> · {t('help.subtitle')}</Text>
      </Box>

      <Box flexDirection="row" gap={1}>
        <KeybindColumn />
        <FeaturesColumn />
      </Box>

      <Box marginTop={1} flexDirection="row" gap={1}>
        <FilesColumn />
        <AboutColumn />
      </Box>
    </Box>
  );
}

function Panel({
  title,
  color,
  children,
  width,
}: {
  title: string;
  color: string;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color as any}
      paddingX={1}
      width={width}
    >
      <Text bold color={color as any}>
        {title}
      </Text>
      {children}
    </Box>
  );
}

function Row({ k, v, color = 'white' }: { k: string; v: string; color?: string }) {
  return (
    <Box>
      <Text color="cyan">{k.padEnd(22)}</Text>
      <Text color={color as any}>{v}</Text>
    </Box>
  );
}

function KeybindColumn() {
  return (
    <Panel title={t('help.keybindings')} color="cyan" width="50%">
      <Text color="gray">{t('help.global')}</Text>
      <Row k="1 2 3 4 5 6" v={t('tab.dashboard') + ' / ' + t('tab.models') + ' / ' + t('tab.install') + ' / ' + t('tab.tune') + ' / ' + t('tab.help') + ' / ' + t('tab.settings')} />
      <Row k="Tab / Shift+Tab" v="cycle" />
      <Row k="?" v={t('tab.help')} />
      <Row k="," v={t('tab.settings')} />
      <Row k="q · Ctrl+C" v="quit" />
      <Text />
      <Text color="gray">{t('help.section.dashboard')}</Text>
      <Text color="gray">  {t('help.section.dashboardNote')}</Text>
      <Text />
      <Text color="gray">{t('help.section.models')}</Text>
      <Row k={`${icon.arrowUp} ${icon.arrowDown}`} v="nav" />
      <Row k="L · G" v="launch" />
      <Row k="I · B · d · Alt+d · r" v="reinstall · backup · rm · rm+files · refresh" />
      <Text />
      <Text color="gray">{t('help.section.install')}</Text>
      <Row k="enter" v="submit URL" />
      <Text color="gray">  {t('help.section.installNote')}</Text>
      <Text />
      <Text color="gray">{t('help.section.tune')}</Text>
      <Row k={`${icon.arrowUp} ${icon.arrowDown}`} v="nav" />
      <Row k={`${icon.arrowLeft} ${icon.arrowRight}`} v="cycle" />
      <Row k="e · d · s" v="edit · default · suggested" />
      <Row k="x · R · a" v="all→def · all→sug · apply" />
    </Panel>
  );
}

function FeaturesColumn() {
  return (
    <Panel title={t('help.tabsOverview')} color="yellow" width="50%">
      <Text color="cyan">{t('tab.dashboard')}</Text>
      <Text color="gray">{t('help.desc.dashboard')}</Text>
      <Text />
      <Text color="cyan">{t('tab.models')}</Text>
      <Text color="gray">{t('help.desc.models')}</Text>
      <Text />
      <Text color="cyan">{t('tab.install')}</Text>
      <Text color="gray">{t('help.desc.install')}</Text>
      <Text />
      <Text color="cyan">{t('tab.tune')}</Text>
      <Text color="gray">{t('help.desc.tune')}</Text>
    </Panel>
  );
}

function FilesColumn() {
  return (
    <Panel title={t('help.filesTitle')} color="green" width="50%">
      <Text color="gray">{t('help.filesWrites')}</Text>
      <Text />
      <Text>
        <Text color="cyan">{'<dir>/<repo>/<quant>/'}</Text>
      </Text>
      <Text>  <Text color="cyan">{'<filename>.gguf'}</Text>  <Text color="gray">{t('help.filesGgufDesc')}</Text></Text>
      <Text>  <Text color="cyan">Modelfile</Text>          <Text color="gray">{t('help.filesModelfileDesc')}</Text></Text>
      <Text />
      <Text color="gray">{t('help.filesRerun', { cmd: 'ollama create <tag> -f Modelfile' })}</Text>
    </Panel>
  );
}

function AboutColumn() {
  return (
    <Panel title={t('help.projectTitle')} color="magenta" width="50%">
      <Row k={t('help.project.written')}  v={t('help.project.writtenValue')} />
      <Row k={t('help.project.icons')}    v={t('help.project.iconsValue')} />
      <Row k={t('help.project.live')}     v={t('help.project.liveValue')} />
      <Row k={t('help.project.crossOS')}  v={t('help.project.crossOSValue')} />
      <Row k={t('help.project.cost')}     v={t('help.project.costValue')} />
      <Text />
      <Text color="gray">{t('help.cliNote')}</Text>
      <Text color="gray">  --dir, --token, --code, --ctx, --tab, --no-fullscreen</Text>
    </Panel>
  );
}
