'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const { MongoClient } = require('mongoose').mongo;

const DATABASE = 'betunio';
const COLLECTION = 'admins';
const USERNAME = 'admin';

const ERROR_MESSAGES = {
    NOT_TERMINAL: 'Пусни скрипта директно в терминал, без подаване на паролата чрез команда или файл.',
    ARGUMENTS: 'Пусни скрипта без допълнителни аргументи. Паролата се въвежда само при скритата подкана.',
    CONFIG: 'Липсва или не може да се прочете настройката MONGODB_URI от средата или местния .env файл.',
    CANCELLED: 'Проверката е прекратена.',
    ADMIN_MISSING: 'В betunio.admins няма запис с потребителско име admin. Паролата не е проверена.',
    ADMIN_DUPLICATE: 'В betunio.admins има повече от един запис admin. Паролата не е проверена.',
    INVALID_HASH: 'Записът admin няма поддържан bcrypt формат. Паролата не е проверена.',
    FAILED: 'Проверката не успя. Провери достъпа до Atlas и настройката за връзка. Няма резултат за паролата.'
};

class CheckError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function readMongoUri() {
    if (process.env.MONGODB_URI) return process.env.MONGODB_URI;

    try {
        const settings = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env')));
        if (settings.MONGODB_URI) return settings.MONGODB_URI;
    } catch (_) {
        // Do not print configuration contents or the underlying error.
    }

    throw new CheckError('CONFIG');
}

async function askForPermission(input, output) {
    const answer = await readTerminalLine(
        input,
        output,
        'Разрешаваш ли връзка към MongoDB Atlas само за четене на admin в betunio.admins? Напиши ДА: ',
        false
    );
    return answer.trim().toUpperCase() === 'ДА';
}

function readTerminalLine(input, output, prompt, hidden) {
    return new Promise((resolve, reject) => {
        let password = '';
        let finished = false;
        const wasRaw = !!input.isRaw;

        const finish = error => {
            if (finished) return;
            finished = true;
            input.removeListener('keypress', onKey);
            input.removeListener('end', onEnd);
            input.removeListener('error', onEnd);
            process.removeListener('SIGINT', onSignal);
            process.removeListener('SIGTERM', onSignal);
            process.removeListener('SIGHUP', onSignal);
            input.pause();
            input.setRawMode(wasRaw);
            output.write('\n');

            if (error) {
                password = '';
                reject(error);
            } else {
                const entered = password;
                password = '';
                resolve(entered);
            }
        };

        const onEnd = () => finish(new CheckError('CANCELLED'));
        const onSignal = () => finish(new CheckError('CANCELLED'));
        const onKey = (text, key = {}) => {
            if (key.ctrl && (key.name === 'c' || key.name === 'd')) return onEnd();
            if (key.name === 'return' || key.name === 'enter') return finish();
            if (key.name === 'backspace') {
                if (!hidden && password) output.write('\b \b');
                password = Array.from(password).slice(0, -1).join('');
                return;
            }
            if (key.ctrl && key.name === 'u') {
                if (!hidden) output.write('\b \b'.repeat(Array.from(password).length));
                password = '';
                return;
            }
            if (key.ctrl || key.meta) return;
            if (text && !/[\x00-\x1f\x7f]/.test(text)) {
                password += text;
                if (!hidden) output.write(text);
            }
        };

        readline.emitKeypressEvents(input);
        input.on('keypress', onKey);
        input.once('end', onEnd);
        input.once('error', onEnd);
        process.once('SIGINT', onSignal);
        process.once('SIGTERM', onSignal);
        process.once('SIGHUP', onSignal);
        input.setRawMode(true);
        input.resume();
        output.write(prompt);
    });
}

function readHiddenPassword(input, output) {
    return readTerminalLine(
        input,
        output,
        'Парола (въвеждането е скрито; натисни Enter накрая): ',
        true
    );
}

async function compareAdminPassword(client, password) {
    // Use the driver directly: no application models, save hooks, or index creation.
    const admins = await client.db(DATABASE).collection(COLLECTION)
        .find({ username: USERNAME }, { projection: { _id: 0, password: 1 }, maxTimeMS: 5000 })
        .limit(2)
        .toArray();

    if (admins.length === 0) throw new CheckError('ADMIN_MISSING');
    if (admins.length > 1) throw new CheckError('ADMIN_DUPLICATE');

    const storedPassword = admins[0].password;
    if (typeof storedPassword !== 'string' ||
        !/^\$2[aby]\$(?:0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/.test(storedPassword)) {
        throw new CheckError('INVALID_HASH');
    }

    return bcrypt.compare(password, storedPassword);
}

async function main() {
    let password = '';
    let client;

    try {
        if (process.argv.length > 2) throw new CheckError('ARGUMENTS');
        if (!process.stdin.isTTY || !process.stderr.isTTY || !process.stdin.setRawMode) {
            throw new CheckError('NOT_TERMINAL');
        }

        const mongoUri = readMongoUri();
        const allowed = await askForPermission(process.stdin, process.stderr);
        if (!allowed) throw new CheckError('CANCELLED');

        password = await readHiddenPassword(process.stdin, process.stderr);
        client = new MongoClient(mongoUri, {
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 10000,
            maxPoolSize: 1,
            minPoolSize: 0,
            retryWrites: false,
            readPreference: 'primary'
        });

        let matches;
        try {
            await client.connect();
            matches = await compareAdminPassword(client, password);
        } finally {
            password = '';
            await client.close();
            client = undefined;
        }

        process.stdout.write(matches ? 'PASSWORD_MATCH\n' : 'PASSWORD_MISMATCH\n');
        return matches ? 0 : 1;
    } catch (error) {
        const code = error instanceof CheckError ? error.code : 'FAILED';
        process.stderr.write((ERROR_MESSAGES[code] || ERROR_MESSAGES.FAILED) + '\n');
        return code === 'CANCELLED' ? 3 : 2;
    } finally {
        password = '';
        if (client) await client.close().catch(() => {});
    }
}

if (require.main === module) {
    main().then(code => { process.exitCode = code; }).catch(() => {
        process.stderr.write(ERROR_MESSAGES.FAILED + '\n');
        process.exitCode = 2;
    });
}

module.exports = { compareAdminPassword, main, readHiddenPassword };
