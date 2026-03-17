import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const schemaSourcePath = path.join(projectRoot, 'app-data', 'stories.schema.json');

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readUtf8(filePath));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function copySchema(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(schemaSourcePath, path.join(targetDir, 'stories.schema.json'));
}

function replaceStringsDeep(value, replacements = []) {
  if (typeof value === 'string') {
    return replacements.reduce((current, [from, to]) => current.split(from).join(to), value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => replaceStringsDeep(entry, replacements));
  }
  if (value && typeof value === 'object') {
    const next = {};
    Object.entries(value).forEach(([key, entryValue]) => {
      next[key] = replaceStringsDeep(entryValue, replacements);
    });
    return next;
  }
  return value;
}

function ensureSentence(text = '') {
  const normalized = String(text || '').trim();
  if (!normalized) return '';
  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`;
}

function deriveTitleFromObjective(objective = '') {
  const normalized = String(objective || '').trim().replace(/[.!?]+$/u, '');
  if (!normalized) return 'Mission';
  const patterns = [
    [/^Zeige\s+/iu, ''],
    [/^Zaehle\s+/iu, ''],
    [/^Summiere\s+/iu, ''],
    [/^Finde\s+/iu, ''],
    [/^Entferne\s+/iu, ''],
    [/^Setze\s+/iu, ''],
    [/^Aendere\s+/iu, ''],
    [/^Erhoehe\s+/iu, ''],
    [/^Ziehe\s+/iu, ''],
    [/^Sammle\s+/iu, ''],
    [/^Gib\s+/iu, ''],
    [/^Trage\s+mich\s+als\s+/iu, ''],
    [/^Trage\s+/iu, ''],
    [/^Lege\s+/iu, '']
  ];
  let title = normalized;
  for (const [pattern, replacement] of patterns) {
    if (pattern.test(title)) {
      title = title.replace(pattern, replacement);
      break;
    }
  }
  title = title
    .replace(/^mir\s+/iu, '')
    .replace(/^alle\s+/iu, 'Alle ')
    .replace(/^den\s+/iu, 'Den ')
    .replace(/^die\s+/iu, 'Die ')
    .replace(/^das\s+/iu, 'Das ')
    .replace(/^meine\s+/iu, 'Meine ')
    .replace(/^mein\s+/iu, 'Mein ')
    .replace(/^den\s+Status\s+/iu, 'Den Status ')
    .replace(/^auf\s+/iu, 'Auf ')
    .trim();
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : 'Mission';
}

function collectTablesFromSql(sql = '') {
  const tables = [];
  const patterns = [
    /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)/giu,
    /\bJOIN\s+([A-Za-z_][A-Za-z0-9_]*)/giu,
    /\bUPDATE\s+([A-Za-z_][A-Za-z0-9_]*)/giu,
    /\bINTO\s+([A-Za-z_][A-Za-z0-9_]*)/giu,
    /\bDELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)/giu,
    /\bCREATE\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)/giu
  ];
  patterns.forEach((pattern) => {
    let match = pattern.exec(sql);
    while (match) {
      tables.push(match[1]);
      match = pattern.exec(sql);
    }
  });
  return [...new Set(tables.map((entry) => String(entry || '').trim()).filter(Boolean))];
}

function makeAdvanceHint(sql = '') {
  const normalized = String(sql || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Nutze die benoetigten SQL-Bausteine fuer diese Mission.';

  const tables = collectTablesFromSql(normalized);
  const tableHint = tables.length === 1
    ? ` auf \`${tables[0]}\``
    : (tables.length > 1 ? ` auf ${tables.map((entry) => `\`${entry}\``).join(' und ')}` : '');

  if (/^SELECT\b/iu.test(normalized)) {
    const fragments = [`Nutze SELECT${tableHint}`];
    if (/\bJOIN\b/iu.test(normalized)) fragments.push('verbinde die Tabellen per JOIN');
    if (/\bWHERE\b/iu.test(normalized)) fragments.push('filtere mit WHERE');
    if (/\bGROUP\s+BY\b/iu.test(normalized)) fragments.push('gruppiere mit GROUP BY');
    if (/\bHAVING\b/iu.test(normalized)) fragments.push('pruefe die Gruppen mit HAVING');
    if (/\bORDER\s+BY\b/iu.test(normalized)) fragments.push('sortiere mit ORDER BY');
    if (/\bCOUNT\s*\(/iu.test(normalized)) fragments.push('nutze COUNT fuer die Auswertung');
    if (/\bSUM\s*\(/iu.test(normalized)) fragments.push('nutze SUM fuer die Auswertung');
    if (/\bAVG\s*\(/iu.test(normalized)) fragments.push('nutze AVG fuer die Auswertung');
    if (/\bLIKE\b/iu.test(normalized)) fragments.push('verwende LIKE fuer das Muster');
    if (/\bIN\s*\(/iu.test(normalized)) fragments.push('nutze IN fuer die Werteliste');
    return `${fragments.join(', ')}.`;
  }

  if (/^INSERT\s+INTO\b/iu.test(normalized)) {
    return `Nutze INSERT INTO${tableHint} und trage die geforderten Werte in die passenden Spalten ein.`;
  }
  if (/^UPDATE\b/iu.test(normalized)) {
    const fragments = [`Nutze UPDATE${tableHint}`];
    if (/\bSET\b/iu.test(normalized)) fragments.push('setze die benoetigten Werte mit SET');
    if (/\bWHERE\b/iu.test(normalized)) fragments.push('grenze die betroffenen Zeilen mit WHERE ein');
    return `${fragments.join(', ')}.`;
  }
  if (/^DELETE\s+FROM\b/iu.test(normalized)) {
    return `Nutze DELETE FROM${tableHint} und grenze die betroffenen Zeilen mit WHERE ein.`;
  }
  if (/^CREATE\s+TABLE\b/iu.test(normalized)) {
    return `Lege die Tabelle${tableHint} an und vergebe die geforderten Spaltendefinitionen.`;
  }
  return 'Nutze die benoetigten SQL-Bausteine fuer diese Mission.';
}

function makeAdvanceOn(sql = '') {
  const normalized = String(sql || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const tokens = [];
  const pushToken = (value) => {
    const token = String(value || '').trim().toUpperCase();
    if (!token || token.length < 2) return;
    if (!tokens.includes(token)) tokens.push(token);
  };

  const keywordChecks = [
    'SELECT', 'FROM', 'WHERE', 'JOIN', 'GROUP', 'HAVING', 'ORDER', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'COUNT', 'SUM', 'AVG', 'LIKE'
  ];
  keywordChecks.forEach((keyword) => {
    if (new RegExp(`\\b${keyword}\\b`, 'iu').test(normalized)) pushToken(keyword);
  });

  collectTablesFromSql(normalized).forEach(pushToken);

  const columnPatterns = [
    /\bSET\s+([A-Za-z_][A-Za-z0-9_]*)\b/giu,
    /\bWHERE\s+([A-Za-z_][A-Za-z0-9_]*)\b/giu,
    /\bORDER\s+BY\s+([A-Za-z_][A-Za-z0-9_.]*)\b/giu,
    /\bGROUP\s+BY\s+([A-Za-z_][A-Za-z0-9_.]*)\b/giu
  ];
  columnPatterns.forEach((pattern) => {
    let match = pattern.exec(normalized);
    while (match) {
      String(match[1] || '')
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach(pushToken);
      match = pattern.exec(normalized);
    }
  });

  const literalMatches = [...normalized.matchAll(/'([^']+)'/g)]
    .flatMap((match) => String(match[1] || '').split(/[^A-Za-z0-9_]+/u))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 3);
  literalMatches.slice(0, 2).forEach(pushToken);

  const numberMatches = [...normalized.matchAll(/\b\d+\b/g)].map((match) => match[0]);
  numberMatches.slice(0, 2).forEach(pushToken);

  const finalTokens = tokens.slice(0, 8);
  return {
    all: finalTokens.map((token) => ({
      type: 'statement-contains',
      tokens: [token]
    }))
  };
}

function buildGuideSceneText(step, config, bubbleText) {
  const mappedDialogueSpeakers = config.dialogueSpeakersByStep?.[step];
  const parts = String(bubbleText || '')
    .split('<br>')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (Array.isArray(mappedDialogueSpeakers) && mappedDialogueSpeakers.length === parts.length && parts.length > 1) {
    return {
      text: parts.map((entry) => entry).join('\n'),
      dialogueTurns: parts.map((entry, index) => ({
        speaker: mappedDialogueSpeakers[index],
        text: entry
      }))
    };
  }

  return {
    text: String(bubbleText || '').replace(/<br>/g, '\n').trim(),
    dialogueTurns: null
  };
}

function buildDocStoryJson(docPath, config) {
  const raw = readUtf8(docPath).replace(/\r/g, '').trim();
  const lines = raw.split('\n').filter(Boolean);
  if (lines.length <= 1) {
    throw new Error(`Keine verwertbaren Basisdaten in ${docPath}`);
  }

  const rows = lines.slice(1).map((line, lineIndex) => {
    const cols = line.split('\t');
    if (cols.length < 4) {
      throw new Error(`Unerwartetes Spaltenformat in ${docPath}:${lineIndex + 2}`);
    }
    const [stepRaw, bubbleText, _sqlArea, solutionField] = cols;
    const step = Number(stepRaw);
    const parts = String(solutionField || '').split('|');
    if (parts.length < 2) {
      throw new Error(`Loesungsspalte ohne Trenner in ${docPath}:${lineIndex + 2}`);
    }
    const objective = ensureSentence(parts[0]);
    const starterSql = String(parts.slice(1).join('|') || '').trim();
    return { step, bubbleText, objective, starterSql };
  });

  const titles = rows.map(({ step, bubbleText, objective, starterSql }) => {
    const titleBody = deriveTitleFromObjective(objective);
    const sceneSpeaker = config.sceneSpeakerByStep?.[step]
      || (step >= (config.renameStep ?? 16)
        ? (config.afterRenameSpeaker || config.afterRenameName || config.initialSpeaker || 'Fremde')
        : (config.initialSpeaker || 'Fremde'));
    const sceneContent = buildGuideSceneText(step, config, bubbleText);
    const guideScene = {
      sceneTitle: `Mission ${step}`,
      speaker: sceneSpeaker,
      text: sceneContent.text,
      objective,
      advanceHint: makeAdvanceHint(starterSql),
      editorComment: `Mission ${step}: ${titleBody}`,
      starterSql,
      successMessage: `Schritt ${step} abgeschlossen.`,
      advanceOn: makeAdvanceOn(starterSql)
    };
    if (sceneContent.dialogueTurns) {
      guideScene.dialogueTurns = sceneContent.dialogueTurns;
    }

    return {
      id: `${config.idPrefix}-${String(step).padStart(2, '0')}`,
      title: `Schritt ${step}: ${titleBody}`,
      treeLabel: `${step} ${titleBody}`,
      subtitle: config.subtitle,
      stepLabel: `${step + 1} / ${rows.length}`,
      status: step === 0 ? 'aktiv' : 'neu',
      guideScenes: [guideScene]
    };
  });

  return {
    rootLabel: config.subtitle,
    titles
  };
}

function generateDocStory(docPath, config, targetDir) {
  const storyJson = buildDocStoryJson(docPath, config);
  writeJson(path.join(targetDir, 'stories.json'), storyJson);
  copySchema(targetDir);
}

function generateClonedStory(sourcePath, targetDir, replacements = []) {
  const sourceJson = readJson(sourcePath);
  const clonedJson = replaceStringsDeep(sourceJson, replacements);
  writeJson(path.join(targetDir, 'stories.json'), clonedJson);
  copySchema(targetDir);
}

function updateManifest(manifestPath) {
  const manifest = readJson(manifestPath);
  if (manifest?.storiesByMode && typeof manifest.storiesByMode === 'object') {
    Object.values(manifest.storiesByMode).forEach((entries) => {
      (Array.isArray(entries) ? entries : []).forEach((entry) => {
        if (entry && typeof entry === 'object' && 'optional' in entry) {
          delete entry.optional;
        }
      });
    });
  }
  writeJson(manifestPath, manifest);
}

const kronfesteConfig = {
  subtitle: 'Das Siegel der Kronfeste',
  idPrefix: 'story-kronfeste',
  initialSpeaker: 'Fremde',
  renameStep: 16,
  afterRenameName: 'Selma',
  sceneSpeakerByStep: {
    3: 'Hannes',
    6: 'Konrad',
    8: 'Gerrit',
    14: 'Lene Handel',
    15: 'Bruno Muenz',
    18: 'Almar',
    19: 'Gerrit',
    21: 'Hannes',
    22: 'Peregrin Feder',
    24: 'Peregrin Feder',
    26: 'Viktor Wachs',
    33: 'Cedrik Siegel',
    34: 'Cedrik Siegel'
  },
  dialogueSpeakersByStep: {
    3: ['Hannes', 'Fremde'],
    8: ['Gerrit', 'Fremde'],
    18: ['Almar', 'Selma'],
    22: ['Peregrin Feder', 'Selma'],
    34: ['Cedrik Siegel', 'Selma']
  }
};

const schmugglerConfig = {
  subtitle: 'Die Spur des Schmugglers',
  idPrefix: 'story-schmuggler',
  initialSpeaker: 'Fremde',
  renameStep: 16,
  afterRenameName: 'Lina',
  sceneSpeakerByStep: {
    3: 'Hannes',
    6: 'Gregor Anleger',
    8: 'Lorenz Eisen',
    14: 'Lene Handel',
    15: 'Bruno Zoll',
    18: 'Balduin Laib',
    19: 'Lorenz Eisen',
    21: 'Hannes',
    22: 'Konrad Feder',
    24: 'Konrad Feder',
    26: 'Silas Schmuggler',
    34: 'Hauke Steuer',
    35: 'Hauke Steuer'
  },
  dialogueSpeakersByStep: {
    3: ['Hannes', 'Fremde'],
    8: ['Lorenz Eisen', 'Fremde'],
    18: ['Balduin Laib', 'Lina'],
    22: ['Konrad Feder', 'Lina'],
    35: ['Hauke Steuer', 'Lina']
  }
};

const rabensandReplacements = [
  ['Das ist ja das Geheimnis des Markthofs!', 'Das sind also die Haendler von Rabensand!'],
  ['Das Geheimnis des Markthofs', 'Die Haendler von Rabensand'],
  ['story-markthof', 'story-rabensand'],
  ['Suedtor', 'Salztor'],
  ['Markthof', 'Rabensand'],
  ['Gerbergasse', 'Duenengang'],
  ['Baldur Laib', 'Yarin Dattel'],
  ['Lennart Eisen', 'Samir Eisen'],
  ['Klara Krume', 'Mina Sand'],
  ['Gregor Zins', 'Marek Salz'],
  ['Kaspar Klinge', 'Sadir Sand'],
  ['Borik Kessel', 'Borek Kessel'],
  ['Tabea Teig', 'Talia Teig'],
  ['Rika Klinge', 'Yara Sand'],
  ['Bruno Markt', 'Hakim Markt'],
  ['Konrad Feder', 'Nabil Feder'],
  ['Hannes Pfeffer', 'Hannes Safran'],
  ['Falk Faehre', 'Jorin Segel'],
  ['Faehrmaenner', 'Schiffer'],
  ['Faehrmann', 'Schiffer'],
  ['Gewuerzbeutel', 'Safranbeutel'],
  ['Siegelring', 'Silberring'],
  ['Leinenrolle', 'Seidentuch'],
  ['Laterne', 'Oellampe'],
  ['Lea', 'Nura'],
  ['Flussseite', 'Bucht'],
  ['Fluss', 'Bucht']
];

const wachturmReplacements = [
  ['Hier ist dein Passierschein mit dem Siegel der Kronfeste. Jetzt kannst du durch das Haupttor reisen.', 'Hier ist dein Signalzeichen des Wachturms. Jetzt kannst du ueber die Zugbruecke fliehen.'],
  ['Das Siegel der Kronfeste', 'Sturm auf den Wachturm'],
  ['story-kronfeste', 'story-wachturm'],
  ['Torwall', 'Aussensteg'],
  ['Muenzhof', 'Signalhof'],
  ['Kronarchiv', 'Wachturm'],
  ['Almar Laib', 'Raban Brot'],
  ['Gerrit Eisen', 'Torvin Eisen'],
  ['Marta Mehl', 'Mira Mehl'],
  ['Konrad Pfennig', 'Brann Taler'],
  ['Viktor Wachs', 'Darian Horn'],
  ['Bardo Kessel', 'Borek Kessel'],
  ['Ulf Kessel', 'Udo Kessel'],
  ['Cedrik Siegel', 'Leif Funk'],
  ['Tilda Teig', 'Tilda Korn'],
  ['Odo Hammer', 'Odo Mast'],
  ['Ysra Wachs', 'Mira Horn'],
  ['Bruno Muenz', 'Bruno Funke'],
  ['Peregrin Feder', 'Orin Mast'],
  ['Ida Muenz', 'Ida Funke'],
  ['Hannes Pfeffer', 'Hannes Rauch'],
  ['Kammerzofe', 'Turmhilfe'],
  ['Archivar', 'Signalwart'],
  ['Siegelmeister', 'Turmmeister'],
  ['Siegelwachs', 'Signalhorn'],
  ['Messingring', 'Eisenhaken'],
  ['Tintenfass', 'Leuchtbecher'],
  ['Pergamentrolle', 'Wachrolle'],
  ['Oellampe', 'Leuchtlampe'],
  ['Selma', 'Rhea'],
  ['das Siegel', 'das Leuchtfeuer'],
  ['Siegel', 'Leuchtfeuer']
];

const steinbruchReplacements = [
  ['Das Gold der Kupfermine', 'Die Tore von Steinbruch'],
  ['story-kupfermine', 'story-steinbruch'],
  ['Kupfermine', 'Steinbruch'],
  ['Stollenmund', 'Nordtor'],
  ['Schmelzhof', 'Torhof'],
  ['Tiefstollen', 'Bruchkante'],
  ['Merten Laib', 'Tarek Brot'],
  ['Levin Eisen', 'Borin Eisen'],
  ['Klara Krume', 'Sina Schotter'],
  ['Torben Taler', 'Rurik Tor'],
  ['Kuno Erz', 'Raban Stein'],
  ['Falk Seil', 'Lukas Tor'],
  ['Runa Erz', 'Rika Stein'],
  ['Bruno Schurf', 'Bruno Bruch'],
  ['Konrad Karte', 'Konrad Pfad'],
  ['Erzlampe', 'Torrolle'],
  ['Kupferring', 'Steinkeil'],
  ['Seilrolle', 'Kettenrolle'],
  ['Werkzeugkiste', 'Windenkiste'],
  ['Grubenhelm', 'Wappenplatte'],
  ['Aufzugfuehrer', 'Torwaechter'],
  ['Stollenhilfe', 'Bruchhilfe'],
  ['Grubenklinge', 'Steinklinge'],
  ['Mara', 'Tessa'],
  ['Bergpfad', 'Passstrasse'],
  ['unter Tage', 'hinter den Toren']
];

const dornwallReplacements = [
  ['Die Spur des Schmugglers', 'Der letzte Kurier von Dornwall'],
  ['story-schmuggler', 'story-dornwall'],
  ['Fischmarkt', 'Westtor'],
  ['Zollhof', 'Botenhof'],
  ['Lagerkai', 'Dornwall'],
  ['Balduin Laib', 'Darin Laib'],
  ['Lorenz Eisen', 'Lorik Eisen'],
  ['Mina Krume', 'Mina Korn'],
  ['Gregor Anleger', 'Gregor Tor'],
  ['Silas Schmuggler', 'Marek Dorn'],
  ['Rike Schmuggler', 'Elin Dorn'],
  ['Bruno Zoll', 'Bruno Bote'],
  ['Konrad Feder', 'Konrad Brief'],
  ['Hauke Steuer', 'Lenn Kurier'],
  ['Hafenmagd', 'Botin'],
  ['Kapitaene', 'Kuriere'],
  ['Kapitaen', 'Kurier'],
  ['Schmuggler', 'Wegelagerer'],
  ['Taurolle', 'Briefrolle'],
  ['Kupferkompass', 'Siegeltasche'],
  ['Leinenballen', 'Botenbeutel'],
  ['Sturmlaterne', 'Wegeleuchte'],
  ['Lina', 'Valea'],
  ['Schiff', 'Kurierwagen'],
  ['Hafenstadt', 'Grenzstadt'],
  ['Hafenmeister', 'Torvogt'],
  ['Hafenloch', 'Grenzloch']
];

function main() {
  generateDocStory(
    path.join(projectRoot, '__dokumentation', 'Story_base_information', 'medium', 'Das Siegel der Kronfeste.md'),
    kronfesteConfig,
    path.join(projectRoot, 'Storys', 'Das Siegel der Kronfeste')
  );

  generateDocStory(
    path.join(projectRoot, '__dokumentation', 'Story_base_information', 'medium', 'Die Spur des Schmugglers.md'),
    schmugglerConfig,
    path.join(projectRoot, 'Storys', 'Die Spur des Schmugglers')
  );

  generateClonedStory(
    path.join(projectRoot, 'Storys', 'Das Geheimnis des Markthofs', 'stories.json'),
    path.join(projectRoot, 'Storys', 'Die Händler von Rabensand'),
    rabensandReplacements
  );

  generateClonedStory(
    path.join(projectRoot, 'Storys', 'Das Gold der Kupfermine', 'stories.json'),
    path.join(projectRoot, 'Storys', 'Die Tore von Steinbruch'),
    steinbruchReplacements
  );

  generateClonedStory(
    path.join(projectRoot, 'Storys', 'Das Siegel der Kronfeste', 'stories.json'),
    path.join(projectRoot, 'Storys', 'Sturm auf den Wachturm'),
    wachturmReplacements
  );

  generateClonedStory(
    path.join(projectRoot, 'Storys', 'Die Spur des Schmugglers', 'stories.json'),
    path.join(projectRoot, 'Storys', 'Der letzte Kurier von Dornwall'),
    dornwallReplacements
  );

  updateManifest(path.join(projectRoot, 'Storys', 'stories.index.json'));
  updateManifest(path.join(projectRoot, 'app-data', 'stories.index.json'));
}

main();
