import { enumerateSlashCommands, filterSlashCommands, BUILTIN_COMMANDS } from '../src/data/slashCommands.js';

async function main() {
  console.log(`=== Slash Command Test ===`);
  console.log(`Builtin commands: ${BUILTIN_COMMANDS.length}`);

  const commands = await enumerateSlashCommands(process.cwd());
  const builtins = commands.filter(c => c.type === 'builtin');
  const customs = commands.filter(c => c.type === 'custom');
  const plugins = commands.filter(c => c.type === 'plugin');
  const skills = commands.filter(c => c.type === 'skill');

  console.log(`\nTotal: ${commands.length}`);
  console.log(`  Builtin: ${builtins.length}`);
  console.log(`  Custom: ${customs.length}`);
  console.log(`  Plugin: ${plugins.length}`);
  console.log(`  Skill: ${skills.length}`);

  if (customs.length > 0) {
    console.log(`\nCustom commands sample:`);
    customs.slice(0, 3).forEach(c => console.log(`  /${c.name} (${c.source ?? 'unknown'})`));
  }

  console.log(`\nFilter 'co' →`);
  const coResults = filterSlashCommands(commands, 'co');
  coResults.forEach(c => console.log(`  /${c.name}${c.argumentHint ? ' ' + c.argumentHint : ''} [${c.type}]`));

  console.log(`\nFilter 'mo' →`);
  const moResults = filterSlashCommands(commands, 'mo');
  moResults.forEach(c => console.log(`  /${c.name}${c.argumentHint ? ' ' + c.argumentHint : ''} [${c.type}]`));

  console.log(`\nFilter 're' →`);
  const reResults = filterSlashCommands(commands, 're');
  reResults.forEach(c => console.log(`  /${c.name}${c.argumentHint ? ' ' + c.argumentHint : ''} [${c.type}]`));
}

main().catch(console.error);
