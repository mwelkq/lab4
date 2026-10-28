import http from 'node:http';
import fs from 'node:fs';
import { Command } from 'commander';

const program = new Command();

// -h зайнято під --host, тому довідка лишається лише як --help
program
  .helpOption('--help', 'показати довідку')
  .requiredOption('-i, --input <path>', 'шлях до файлу даних')
  .requiredOption('-h, --host <address>', 'адреса сервера')
  .requiredOption('-p, --port <number>', 'порт сервера')
  .option('-o, --output <path>', 'файл для запису останньої відповіді');

program.parse(process.argv);
const { input, host, port, output } = program.opts();

const portNumber = Number(port);
if (!Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65535) {
  console.error('Помилка: порт має бути цілим числом від 0 до 65535');
  process.exit(1);
}

// Перевірка існування файлу (колбек-API)
fs.access(input, fs.constants.F_OK, (err) => {
  if (err) {
    console.error('Cannot find input file');
    process.exit(1);
  }
  startServer();
});

// Надсилання відповіді; якщо задано --output, спершу записуємо її у файл
function reply(res, status, payload) {
  const body = JSON.stringify(payload);
  const send = (code, text) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(text);
  };
  if (!output) {
    send(status, body);
    return;
  }
  fs.writeFile(output, body, (err) => {
    if (err) {
      send(500, JSON.stringify({ error: 'Помилка запису у вихідний файл' }));
    } else {
      send(status, body);
    }
  });
}

function isNumeric(value) {
  return value.trim() !== '' && Number.isFinite(Number(value));
}

// Значення з файлу -> число або null (порожнє, null, нечислове)
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

// NDJSON: кожен непорожній рядок — окремий JSON-об'єкт
function parseNdjson(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
}

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname !== '/') {
        reply(res, 404, { error: 'Маршрут не знайдено' });
        return;
      }

      const showCylinders = url.searchParams.get('cylinders') === 'true';
      const maxMpgRaw = url.searchParams.get('max_mpg');
      let maxMpg = null;
      if (maxMpgRaw !== null) {
        if (!isNumeric(maxMpgRaw)) {
          reply(res, 400, { error: 'Параметр max_mpg має бути числом' });
          return;
        }
        maxMpg = Number(maxMpgRaw);
      }

      fs.readFile(input, 'utf8', (err, data) => {
        if (err) {
          reply(res, 500, { error: 'Не вдалося прочитати файл даних' });
          return;
        }

        let records;
        try {
          records = parseNdjson(data);
        } catch (e) {
          reply(res, 500, { error: 'Файл даних пошкоджено' });
          return;
        }

        const result = [];
        for (const car of records) {
          const mpg = toNumber(car.mpg);
          // Суворе порівняння; записи без числового mpg під фільтр не потрапляють
          if (maxMpg !== null && !(mpg !== null && mpg < maxMpg)) continue;

          const item = { model: car.model };
          if (showCylinders) item.cyl = toNumber(car.cyl);
          item.mpg = mpg;
          result.push(item);
        }

        reply(res, 200, result);
      });
    } catch (e) {
      reply(res, 500, { error: 'Внутрішня помилка сервера' });
    }
  });

  server.on('error', (e) => {
    console.error('Помилка сервера:', e.message);
    process.exit(1);
  });

  server.listen(portNumber, host, () => {
    console.log(`Сервер запущено: http://${host}:${portNumber}/`);
  });
}