const { Sigaa } = require('../dist/sigaa-all-types');

const sigaa = new Sigaa({
  url: 'https://sigaa.ifsc.edu.br',
  institution: 'IFSC',
  browser: { debug: true, timeout: 60000 }
});

// coloque seu usuário
const username = '';
const password = '';

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
  const days = match[1].split('');
  const turn = match[2];
  const slots = match[3].split('');
  return { days, turn, slots };
}

function formatSchedule(scheduleStr) {
  if (!scheduleStr) return [];
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
  try {
    const account = await sigaa.login(username, password); // login

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
        } else {
          console.log('Horário: ' + (course.schedule || 'Não informado'));
        }
        console.log('');
      }
    }

    // Encerra a sessão
    await account.logoff();
  } finally {
    sigaa.close();
  }
};

main().catch((err) => {
  if (err) console.log(err);
});
