const { Sigaa } = require('../dist/sigaa-all-types');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));
const askHidden = (q) => new Promise((resolve) => {
  process.stdout.write(q);
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  if (stdin.isTTY) stdin.setRawMode(true);
  let input = '';
  const onData = (c) => {
    const ch = c.toString();
    if (ch === '\n' || ch === '\r') { stdin.removeListener('data', onData); if (stdin.isTTY && wasRaw !== undefined) stdin.setRawMode(wasRaw); process.stdout.write('\n'); resolve(input); }
    else if (ch === '\u0003') process.exit();
    else if (ch === '\u007F' || ch === '\b') { if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); } }
    else { input += ch; process.stdout.write('*'); }
  };
  stdin.on('data', onData);
});

const dayNames = {
  '2': 'Segunda',
  '3': 'Terça',
  '4': 'Quarta',
  '5': 'Quinta',
  '6': 'Sexta',
  '7': 'Sábado'
};

const turnNames = {
  'M': 'pela manhã',
  'T': 'à tarde',
  'N': 'à noite'
};

function parseScheduleBlock(block) {
  const match = block.match(/^(\d+)([MTN])(\d+)$/);
  if (!match) return null;
  return { days: match[1].split(''), turn: match[2], slots: match[3].split('') };
}

function formatSchedule(scheduleStr) {
  if (!scheduleStr) return { lines: [], dateMatch: null };
  const dateMatch = scheduleStr.match(/\((\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})\)/);
  const cleanSchedule = scheduleStr.replace(/\(.*\)/, '').trim();
  const blocks = cleanSchedule.split(/\s+/);
  const lines = [];
  let counter = 1;

  for (const block of blocks) {
    const parsed = parseScheduleBlock(block);
    if (!parsed) continue;
    for (const dayCode of parsed.days) {
      const dayName = dayNames[dayCode] || ('Dia ' + dayCode);
      const turnName = turnNames[parsed.turn] || parsed.turn;
      const slotList = parsed.slots.length === 1
        ? parsed.slots[0] + 'ª aula'
        : parsed.slots.slice(0, -1).join('ª, ') + 'ª e ' + parsed.slots[parsed.slots.length - 1] + 'ª aula';
      lines.push(`${counter} - ${dayName} ${turnName}, ${slotList} (${block})`);
      counter++;
    }
  }
  return { lines, dateMatch };
}

const main = async () => {
  console.log('\n  === SIGAA - Disciplinas e Professores ===\n');
  const username = await ask('  Usuario: ');
  const password = await askHidden('  Senha: ');
  console.log('\n  Conectando...\n');

  const sigaa = new Sigaa({
    url: 'https://sigaa.ifsc.edu.br',
    institution: 'IFSC',
    browser: { debug: true, timeout: 60000 }
  });

  try {
    const account = await sigaa.login(username, password);

    const bonds = await account.getActiveBonds();

    for (const bond of bonds) {
      if (bond.type !== 'student') continue;

      console.log('========================================');
      console.log('Matrícula: ' + bond.registration);
      console.log('Curso: ' + bond.program);
      console.log('========================================\n');

      const courses = await bond.getCourses();

      for (const course of courses) {
        console.log('Disciplina: ' + course.title);
        console.log('Semestre: ' + course.period);

        const { lines, dateMatch } = formatSchedule(course.schedule);

        if (dateMatch) {
          console.log('Data de início: ' + dateMatch[1]);
          console.log('Data de fim: ' + dateMatch[2]);
        }

        if (lines.length > 0) {
          console.log('Dias de aula:');
          for (const line of lines) {
            console.log('  ' + line);
          }
        }

        try {
          const members = await course.getMembers();
          if (members.teachers && members.teachers.length > 0) {
            console.log('Professor(es):');
            for (const teacher of members.teachers) {
              let info = '  - ' + teacher.name;
              if (teacher.department) info += ' (' + teacher.department + ')';
              console.log(info);
            }
          }
        } catch (e) {
          console.log('Professor(es): Não disponível');
        }

        console.log('');
      }
    }

    await account.logoff();
  } finally {
    sigaa.close();
    rl.close();
  }
};

main().catch((err) => {
  if (err) console.log(err);
});
