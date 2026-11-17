'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const { MongoClient } = require('mongoose').mongo;
const { readHiddenPassword } = require('./check-admin-password');

const DATABASE = 'betunio';
const COLLECTION = 'admins';
const USERNAME = 'admin';
// models/admin.js uses bcrypt.hash(password, 10) in its pre-save hook.
// This script uses the driver directly, so that hook is never invoked.
const BCRYPT_ROUNDS = 10;
const WRITE_CONFIRMATION = 'СМЕНИ betunio.admins/admin';

const ERROR_MESSAGES = {
    ARGUMENTS: 'Допустими са само режимът без аргументи, --apply или --help. Не подавай парола като аргумент.',
    NOT_TERMINAL: 'Пусни скрипта директно в терминал. Паролата се въвежда само скрито и интерактивно.',
    CONFIG: 'Не може да се прочете настройката MONGODB_URI от средата или местния .env файл.',
    CANCELLED: 'Проверката е прекратена преди запис.',
    TARGET: 'Целевата база или колекция не съвпада с betunio.admins. Записът е отказан.',
    ADMIN_MISSING: 'В betunio.admins няма admin. Записът е отказан.',
    ADMIN_DUPLICATE: 'В betunio.admins има повече от един admin. Записът е отказан.',
    ADMIN_FORMAT: 'Записът admin има неочаквана структура. Записът е отказан.',
    PASSWORD_LENGTH: 'Новата парола не може да бъде празна или да надвишава ограничението на bcrypt от 72 байта. Записът е отказан.',
    PASSWORDS_DIFFER: 'Двете въведени пароли не съвпадат. Записът е отказан.',
    CONFIRMATION: 'Няма изрично потвърждение за смяна. Записът е отказан.',
    HASH_CHECK: 'Местната проверка на новата защитена парола не успя. Записът е отказан.',
    CONCURRENT_CHANGE: 'Записът admin се е променил след първата проверка. Този опит не е сменил паролата.',
    WRITE_UNCERTAIN: 'Резултатът от записа не е потвърден. Не повтаряй смяната автоматично; използвай check-admin-password.js за проверка.',
    VERIFY_FAILED: 'След записа новата парола не е потвърдена. Възможно е смяната да е извършена; не я повтаряй автоматично. Използвай check-admin-password.js.',
    FAILED: 'Подготовката не успя. Не са показани тайни. Провери настройката за връзка и достъпа до Atlas.'
};

class ResetError extends Error {
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
        // Never print configuration values or raw errors.
    }
    throw new ResetError('CONFIG');
}

function askText(prompt) {
    return new Promise(resolve => {
        const terminal = readline.createInterface({
            input: process.stdin,
            output: process.stderr,
            terminal: true,
            historySize: 0
        });
        let finished = false;
        const finish = answer => {
            if (finished) return;
            finished = true;
            terminal.close();
            resolve(answer);
        };
        terminal.once('SIGINT', () => finish(''));
        terminal.once('close', () => finish(''));
        terminal.question(prompt, finish);
    });
}

function targetCollection(client) {
    const database = client.db(DATABASE);
    const collection = database.collection(COLLECTION);
    assertTarget(collection);
    if (database.databaseName !== DATABASE) throw new ResetError('TARGET');
    return collection;
}

function assertTarget(collection) {
    if (collection.namespace !== `${DATABASE}.${COLLECTION}` || collection.collectionName !== COLLECTION) {
        throw new ResetError('TARGET');
    }
}

async function readUniqueAdmin(collection) {
    assertTarget(collection);
    const records = await collection.find(
        { username: USERNAME },
        { projection: { _id: 1, username: 1, password: 1 }, maxTimeMS: 5000 }
    ).limit(2).toArray();

    if (records.length === 0) throw new ResetError('ADMIN_MISSING');
    if (records.length !== 1) throw new ResetError('ADMIN_DUPLICATE');
    const admin = records[0];
    if (admin._id == null || admin.username !== USERNAME || typeof admin.password !== 'string') {
        throw new ResetError('ADMIN_FORMAT');
    }
    return admin;
}

function hasBcryptFormat(value) {
    return /^\$2[aby]\$(?:0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/.test(value);
}

function validateNewPassword(password) {
    if (typeof password !== 'string' || password.length === 0 || Buffer.byteLength(password, 'utf8') > 72) {
        throw new ResetError('PASSWORD_LENGTH');
    }
}

async function updateAdminPassword(collection, initialAdmin, password, confirmation) {
    if (confirmation !== WRITE_CONFIRMATION) throw new ResetError('CONFIRMATION');
    assertTarget(collection);
    validateNewPassword(password);

    const current = await readUniqueAdmin(collection);
    if (String(current._id) !== String(initialAdmin._id) || current.password !== initialAdmin.password) {
        throw new ResetError('CONCURRENT_CHANGE');
    }

    const newHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    if (!await bcrypt.compare(password, newHash)) throw new ResetError('HASH_CHECK');

    let result;
    try {
        result = await collection.updateOne(
            { _id: current._id, username: USERNAME, password: current.password },
            { $set: { password: newHash } },
            { upsert: false, maxTimeMS: 5000, writeConcern: { w: 'majority' } }
        );
    } catch (_) {
        // A lost response does not prove that the server rejected the write.
        throw new ResetError('WRITE_UNCERTAIN');
    }

    if (result.acknowledged && result.matchedCount === 0 && result.modifiedCount === 0) {
        throw new ResetError('CONCURRENT_CHANGE');
    }
    if (!result.acknowledged || result.matchedCount !== 1 || result.modifiedCount !== 1) {
        throw new ResetError('WRITE_UNCERTAIN');
    }

    try {
        const saved = await readUniqueAdmin(collection);
        if (String(saved._id) !== String(current._id) || !await bcrypt.compare(password, saved.password)) {
            throw new ResetError('VERIFY_FAILED');
        }
    } catch (_) {
        throw new ResetError('VERIFY_FAILED');
    }
}

async function main() {
    let client;
    let password = '';
    let repeatedPassword = '';

    try {
        const args = process.argv.slice(2);
        if (args.length === 1 && args[0] === '--help') {
            process.stdout.write('Без аргументи: само проверка.\n--apply: подготвя смяна, която изисква две скрити въвеждания и отделно потвърждение преди запис.\n');
            return 0;
        }
        const apply = args.length === 1 && args[0] === '--apply';
        if (args.length > 0 && !apply) throw new ResetError('ARGUMENTS');
        if (!process.stdin.isTTY || !process.stderr.isTTY || !process.stdin.setRawMode) {
            throw new ResetError('NOT_TERMINAL');
        }

        const uri = readMongoUri();
        process.stderr.write(`Цел: база ${DATABASE}, колекция ${COLLECTION}, потребител ${USERNAME}.\n`);
        process.stderr.write(apply ? 'Режим: смяна само след допълнително потвърждение.\n' : 'Режим: само проверка, без запис.\n');
        const readPermission = await askText('Разрешаваш ли свързване към Atlas за началната проверка само за четене? Напиши ДА: ');
        if (readPermission.trim().toUpperCase() !== 'ДА') throw new ResetError('CANCELLED');

        client = new MongoClient(uri, {
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 10000,
            maxPoolSize: 1,
            minPoolSize: 0,
            retryWrites: false,
            readPreference: 'primary'
        });
        await client.connect();
        const collection = targetCollection(client);
        const admin = await readUniqueAdmin(collection);
        process.stdout.write(`Потвърдена цел: ${collection.namespace}; потребител: ${USERNAME}; намерени записи: 1.\n`);
        process.stdout.write(hasBcryptFormat(admin.password) ? 'Текущ формат на паролата: bcrypt.\n' : 'Текущият формат на паролата не е разпознат като bcrypt.\n');
        if (!apply) {
            process.stdout.write('Проверката приключи без запис.\n');
            return 0;
        }

        process.stderr.write('Въведи новата парола за първи път.\n');
        password = await readHiddenPassword(process.stdin, process.stderr);
        validateNewPassword(password);
        process.stderr.write('Въведи новата парола за втори път.\n');
        repeatedPassword = await readHiddenPassword(process.stdin, process.stderr);
        if (password !== repeatedPassword) throw new ResetError('PASSWORDS_DIFFER');
        repeatedPassword = '';

        process.stderr.write('Предстои промяна единствено на password за admin в betunio.admins.\n');
        const confirmation = await askText(`За да разрешиш реалния запис, въведи точно ${WRITE_CONFIRMATION}: `);
        await updateAdminPassword(collection, admin, password, confirmation);
        password = '';
        process.stdout.write('PASSWORD_UPDATED_AND_VERIFIED\n');
        return 0;
    } catch (error) {
        const code = error && typeof error.code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, error.code) ? error.code : 'FAILED';
        process.stderr.write(ERROR_MESSAGES[code] + '\n');
        return code === 'CANCELLED' || code === 'CONFIRMATION' ? 3 : 2;
    } finally {
        password = '';
        repeatedPassword = '';
        if (client) await client.close().catch(() => {});
    }
}

if (require.main === module) {
    main().then(code => { process.exitCode = code; }).catch(() => {
        process.stderr.write(ERROR_MESSAGES.FAILED + '\n');
        process.exitCode = 2;
    });
}

module.exports = { main, targetCollection, readUniqueAdmin, updateAdminPassword };
